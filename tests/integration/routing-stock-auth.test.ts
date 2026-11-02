import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { requestOtp, verifyOtp, findSessionUser } from "@/server/auth/otp";
import { db } from "@/server/db";
import { config } from "@/server/env";
import { addToCart } from "@/server/services/cart";
import { previewRouting, routeOrder } from "@/server/services/inventory";
import { submitOrder } from "@/server/services/orders";
import { uploadPrescription } from "@/server/services/prescriptions";
import { applyStockImport, discardStockImport, previewStockImport } from "@/server/services/stock-import";
import { buildWorld, inventory, pngFile, type World } from "../support/world";

let w: World;
beforeEach(async () => {
  w = await buildWorld();
});
afterAll(() => db.$disconnect());

async function otcOrder(qty: number, actor = () => w.actors.customerA, member = () => w.members.a.id) {
  await addToCart(actor(), member(), w.products.otc.id, qty);
  return submitOrder(actor(), { familyMemberId: member(), localityId: w.localities.saltLake.id, deliveryAddress: "1 Test Road", paymentMethod: "COD_TEST", prescriptionId: null, source: "CATALOGUE" });
}

describe("routing to the nearest store with sufficient stock", () => {
  it("OTC-only orders skip the pharmacist and route to the only store with stock", async () => {
    const res = await otcOrder(2);
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { items: true } });
    expect(order).toMatchObject({ status: "APPROVED", requiresPharmacist: false, routingStatus: "ROUTED", storeId: w.stores.far.id });
    expect(order.items[0].status).toBe("NOT_REQUIRED");
  });

  it("gives a clear NO_STOCK outcome instead of splitting or over-reserving", async () => {
    const res = await otcOrder(5); // FAR has 3, others 0
    expect(res.routed).toBe(false);
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order).toMatchObject({ routingStatus: "NO_STOCK", storeId: null });
    expect(await db.stockReservation.count({ where: { orderId: res.orderId } })).toBe(0);
    expect((await inventory(w.stores.far.id, w.products.otc.id)).reserved).toBe(0);
    expect(await db.auditEvent.count({ where: { action: "ORDER_ROUTING_NO_STOCK", entityId: res.orderId } })).toBe(1);
  });

  it("preview reports the nearest fulfilling store, or the products nobody can supply", async () => {
    const ok = await previewRouting(w.localities.saltLake.id, [{ productId: w.products.metformin.id, quantity: 2 }]);
    expect(ok.store?.id).toBe(w.stores.near.id);
    const none = await previewRouting(w.localities.saltLake.id, [{ productId: w.products.otc.id, quantity: 9 }]);
    expect(none).toMatchObject({ store: null, unavailableProductIds: [w.products.otc.id] });
  });

  it("does not oversell the last units under concurrent orders", async () => {
    // FAR has 3 thermometers. Five customers each try to take 1 at the same time... from two accounts.
    const members = [w.members.a, w.members.b];
    const actors = [w.actors.customerA, w.actors.customerB];
    const orderIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const member = await db.familyMember.create({ data: { customerId: actors[i % 2].id, name: `p${i}`, relation: "OTHER" } });
      members.push(member);
      await addToCart(actors[i % 2], member.id, w.products.otc.id, 1);
      const order = await db.order.create({
        data: {
          orderNumber: `RX-T${i}`, customerId: actors[i % 2].id, familyMemberId: member.id, status: "APPROVED", deliveryLocalityId: w.localities.saltLake.id, deliveryAddress: "x",
          subtotalPaise: 19900, requiresPharmacist: false,
          items: { create: { productId: w.products.otc.id, requestedProductId: w.products.otc.id, quantity: 1, unitPricePaise: 19900, status: "NOT_REQUIRED", category: "OTC", policyId: (await db.medicinePolicy.findFirstOrThrow({ where: { category: "OTC" } })).id, prescriptionRequired: false, pharmacistApprovalRequired: false, h1RegisterRequired: false } },
        },
      });
      orderIds.push(order.id);
    }
    const results = await Promise.all(orderIds.map((id) => routeOrder(id, null)));
    expect(results.filter((r) => r.routed)).toHaveLength(3);
    const inv = await inventory(w.stores.far.id, w.products.otc.id);
    expect(inv.reserved).toBe(3);
    expect(inv.reserved).toBeLessThanOrEqual(inv.onHand);
    expect(await db.order.count({ where: { routingStatus: "NO_STOCK" } })).toBe(2);
  });

  it("routing twice is idempotent (no double reservation)", async () => {
    const res = await otcOrder(1);
    await Promise.all([routeOrder(res.orderId, null), routeOrder(res.orderId, null)]);
    expect(await db.stockReservation.count({ where: { orderId: res.orderId } })).toBe(1);
    expect((await inventory(w.stores.far.id, w.products.otc.id)).reserved).toBe(1);
  });

  it("the database refuses reservations beyond physical stock", async () => {
    await expect(db.inventoryItem.update({ where: { storeId_productId: { storeId: w.stores.far.id, productId: w.products.otc.id } }, data: { reserved: 99 } })).rejects.toThrow(/reserved_within_onHand/);
  });
});

describe("daily stock CSV import", () => {
  it("previews with row errors, applies valid rows, and re-routes orders waiting for stock", async () => {
    const waiting = await otcOrder(5);
    expect(waiting.routed).toBe(false);

    const csv = ["store_code,sku,quantity_on_hand", "NEAR,THM-01,8", "NEAR,THM-01,1", "NOPE,THM-01,3", "MID,BAD-SKU,2", "MID,TEL40-G,x", "MID,TEL40-G,25"].join("\n");
    await expect(previewStockImport(w.actors.customerA, "x.csv", csv)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { batchId } = await previewStockImport(w.actors.ops, "daily.csv", csv);
    const rows = await db.stockImportRow.findMany({ where: { batchId }, orderBy: { rowNumber: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["VALID", "DUPLICATE", "ERROR", "ERROR", "ERROR", "VALID"]);
    expect((await inventory(w.stores.near.id, w.products.otc.id)).onHand).toBe(0); // preview changes nothing

    const result = await applyStockImport(w.actors.ops, batchId);
    expect(result).toMatchObject({ applied: 2, refused: 0, rerouted: 1 });
    expect((await inventory(w.stores.mid.id, w.products.telmisartan.id)).onHand).toBe(25);
    const routed = await db.order.findUniqueOrThrow({ where: { id: waiting.orderId } });
    expect(routed).toMatchObject({ routingStatus: "ROUTED", storeId: w.stores.near.id });
    await expect(applyStockImport(w.actors.ops, batchId)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a row that would drop stock below open reservations", async () => {
    await otcOrder(3); // reserves all 3 at FAR
    const { batchId } = await previewStockImport(w.actors.ops, "d.csv", "store_code,sku,quantity_on_hand\nFAR,THM-01,1\n");
    expect(await applyStockImport(w.actors.ops, batchId)).toMatchObject({ applied: 0, refused: 1 });
    expect((await inventory(w.stores.far.id, w.products.otc.id)).onHand).toBe(3);
    expect((await db.stockImportRow.findFirstOrThrow({ where: { batchId } })).errorMessage).toMatch(/below units already reserved/);
  });

  it("rejects bad headers and allows discarding a preview", async () => {
    await expect(previewStockImport(w.actors.ops, "d.csv", "a,b\n1,2")).rejects.toMatchObject({ code: "VALIDATION" });
    const { batchId } = await previewStockImport(w.actors.ops, "d.csv", "store_code,sku,quantity_on_hand\nFAR,THM-01,4\n");
    await discardStockImport(w.actors.ops, batchId);
    await expect(applyStockImport(w.actors.ops, batchId)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("imports the shipped sample CSV without errors for the seeded catalogue codes", () => {
    const text = readFileSync(path.join(process.cwd(), "fixtures", "stock", "sample-daily-stock.csv"), "utf8");
    expect(text.split("\n")[0]).toBe("store_code,sku,quantity_on_hand");
  });
});

describe("OTP authentication", () => {
  it("demo OTP signs in an existing account and creates a hashed session", async () => {
    expect(config().demoOtpEnabled).toBe(true);
    await requestOtp("+91 55500 01001", "client-1");
    const { token, user } = await verifyOtp("5550001001", "123456", "client-1");
    expect(user.id).toBe(w.actors.customerA.id);
    expect(await db.session.count({ where: { tokenHash: token } })).toBe(0); // raw token never stored
    expect((await findSessionUser(token))?.id).toBe(w.actors.customerA.id);
    await expect(verifyOtp("5550001001", "123456", "client-1")).rejects.toMatchObject({ code: "VALIDATION" }); // single use
  });

  it("rejects wrong codes and locks the challenge after 5 attempts", async () => {
    await requestOtp("5550001002", "client-2");
    for (let i = 0; i < 5; i++) await expect(verifyOtp("5550001002", "000000", "client-2")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(verifyOtp("5550001002", "123456", "client-2")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.auditEvent.count({ where: { action: "AUTH_LOGIN_FAILED" } })).toBe(6);
  });

  it("rate limits OTP requests per number", async () => {
    for (let i = 0; i < 5; i++) await requestOtp("5550009999", `c${i}`);
    await expect(requestOtp("5550009999", "c6")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("creates a customer (never staff) for a new number", async () => {
    await requestOtp("5550007777", "client-3");
    const { user } = await verifyOtp("5550007777", "123456", "client-3");
    expect(user.role).toBe("CUSTOMER");
    expect(await db.familyMember.count({ where: { customerId: user.id, relation: "SELF" } })).toBe(1);
  });

  it("rejects malformed phone numbers and codes", async () => {
    await expect(requestOtp("12345", "c")).rejects.toThrow(/10-digit/);
    await expect(verifyOtp("5550001001", "12ab56", "c")).rejects.toThrow(/6-digit/);
  });
});

describe("prescription storage at rest", () => {
  it("stores only ciphertext under a random name in the private directory", async () => {
    const rx = await uploadPrescription(w.actors.customerA, { familyMemberId: w.members.a.id, file: pngFile("rx-rina-sen.png") });
    const record = await db.prescription.findUniqueOrThrow({ where: { id: rx.prescriptionId } });
    expect(record.storageKey).toMatch(/^[a-f0-9]{32}\.enc$/);
    const dir = path.resolve(process.cwd(), config().PRIVATE_STORAGE_DIR);
    expect(await readdir(dir)).toContain(record.storageKey);
    const blob = readFileSync(path.join(dir, record.storageKey));
    expect(blob.subarray(0, 4).toString()).toBe("RXE1");
    expect(blob.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  it("accepts a PDF and sends it to manual review when the provider cannot read PDFs", async () => {
    const bytes = readFileSync(path.join(process.cwd(), "fixtures", "prescriptions", "rx-rina-sen.pdf"));
    const rx = await uploadPrescription(w.actors.customerA, { familyMemberId: w.members.a.id, file: { name: "rx.pdf", type: "application/pdf", size: bytes.length, bytes } });
    expect(rx.status).toBe("UNSUPPORTED");
    expect(rx.issues.join()).toMatch(/manually/);
  });

  it("rate limits uploads per customer", async () => {
    for (let i = 0; i < 20; i++) await db.rateLimitHit.create({ data: { key: `upload:${w.actors.customerA.id}` } });
    await expect(uploadPrescription(w.actors.customerA, { familyMemberId: w.members.a.id, file: pngFile("rx-rina-sen.png") })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
