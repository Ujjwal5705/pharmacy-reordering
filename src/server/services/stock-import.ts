import { randomUUID } from "node:crypto";
import { assertRole, type Actor } from "../actor";
import { audit } from "../audit";
import { db } from "../db";
import { parseStockCsv } from "../domain/stock-csv";
import { DomainError } from "../errors";
import { routeOrder } from "./inventory";

export const MAX_STOCK_CSV_BYTES = 2 * 1024 * 1024;

/** Step 1: validate the file and keep every row with its status so operations can review it. */
export async function previewStockImport(actor: Actor | null, fileName: string, text: string) {
  assertRole(actor, ["OPS_ADMIN"]);
  if (Buffer.byteLength(text) > MAX_STOCK_CSV_BYTES) throw new DomainError("VALIDATION", "CSV is larger than 2 MB.");
  const [stores, products] = await Promise.all([
    db.store.findMany({ select: { code: true } }),
    db.product.findMany({ select: { sku: true } }),
  ]);
  const result = parseStockCsv(text, {
    storeCodes: new Set(stores.map((s) => s.code)),
    skus: new Set(products.map((p) => p.sku)),
  });
  if (result.headerErrors.length) throw new DomainError("VALIDATION", "The CSV could not be read.", result.headerErrors);
  if (result.rows.length === 0) throw new DomainError("VALIDATION", "The CSV has no data rows.");

  const batch = await db.$transaction(async (tx) => {
    const b = await tx.stockImportBatch.create({
      data: {
        fileName: fileName.replace(/[^\w.\- ]/g, "_").slice(0, 120) || "stock.csv",
        uploadedById: actor.id,
        totalRows: result.rows.length,
        validRows: result.rows.filter((r) => r.status === "VALID").length,
        errorRows: result.rows.filter((r) => r.status !== "VALID").length,
      },
    });
    await tx.stockImportRow.createMany({ data: result.rows.map((r) => ({ ...r, batchId: b.id })) });
    await audit(tx, { actor, action: "STOCK_IMPORT_PREVIEWED", entityType: "StockImportBatch", entityId: b.id, metadata: { rows: result.rows.length } });
    return b;
  });
  return { batchId: batch.id };
}

/**
 * Step 2: apply valid rows in one transaction. A row whose new quantity is below what is already
 * reserved for open orders is refused (it would oversell), and reported back as an error.
 */
export async function applyStockImport(actor: Actor | null, batchId: string) {
  assertRole(actor, ["OPS_ADMIN"]);
  const result = await db.$transaction(async (tx) => {
    const claimed = await tx.stockImportBatch.updateMany({ where: { id: batchId, status: "PREVIEW" }, data: { status: "APPLIED", appliedAt: new Date() } });
    if (claimed.count !== 1) throw new DomainError("CONFLICT", "This import was already applied or discarded.");
    const rows = await tx.stockImportRow.findMany({ where: { batchId, status: "VALID" } });
    const stores = new Map((await tx.store.findMany()).map((s) => [s.code, s.id]));
    const products = new Map((await tx.product.findMany()).map((p) => [p.sku, p.id]));
    let applied = 0;
    let refused = 0;
    for (const r of rows) {
      const storeId = stores.get(r.storeCode)!;
      const productId = products.get(r.sku)!;
      const n = await tx.$executeRaw`
        INSERT INTO "InventoryItem" ("id", "storeId", "productId", "onHand", "reserved", "lastBatchId", "updatedAt")
        VALUES (${randomUUID()}, ${storeId}, ${productId}, ${r.quantity!}, 0, ${batchId}, NOW())
        ON CONFLICT ("storeId", "productId") DO UPDATE
          SET "onHand" = EXCLUDED."onHand", "lastBatchId" = EXCLUDED."lastBatchId", "updatedAt" = NOW()
          WHERE "InventoryItem"."reserved" <= EXCLUDED."onHand"`;
      if (n === 1) applied++;
      else {
        refused++;
        await tx.stockImportRow.update({
          where: { id: r.id },
          data: { status: "ERROR", errorMessage: "quantity is below units already reserved for open orders" },
        });
      }
    }
    await tx.stockImportBatch.update({ where: { id: batchId }, data: { validRows: applied, errorRows: { increment: refused } } });
    await audit(tx, { actor, action: "STOCK_IMPORT_APPLIED", entityType: "StockImportBatch", entityId: batchId, metadata: { applied, refused } });
    return { applied, refused };
  });

  // New stock may unblock orders that had no single store able to fulfil them.
  const waiting = await db.order.findMany({
    where: { routingStatus: "NO_STOCK", status: { notIn: ["REJECTED", "CANCELLED", "DELIVERED"] } },
    select: { id: true },
  });
  let rerouted = 0;
  for (const o of waiting) {
    const r = await routeOrder(o.id, actor).catch(() => ({ routed: false }));
    if (r.routed) rerouted++;
  }
  return { ...result, rerouted };
}

export async function discardStockImport(actor: Actor | null, batchId: string) {
  assertRole(actor, ["OPS_ADMIN"]);
  const res = await db.stockImportBatch.updateMany({ where: { id: batchId, status: "PREVIEW" }, data: { status: "DISCARDED" } });
  if (res.count !== 1) throw new DomainError("CONFLICT", "Only a previewed import can be discarded.");
}
