import type { Actor } from "../actor";
import { audit } from "../audit";
import { db, type Tx } from "../db";
import { chooseNearestFulfillingStore, haversineKm, rankStoresByDistance, type Point } from "../domain/geo";
import { evaluateCategory } from "../domain/policy";
import { DomainError } from "../errors";
import { loadPolicyRules } from "./catalogue";

class InsufficientStock extends Error {}
class AlreadyRouted extends Error {}

/**
 * Atomically reserves packs if (onHand - reserved) covers them. The conditional UPDATE takes a
 * row lock, so concurrent reservations for the last units cannot both succeed.
 */
export async function reserveUnits(tx: Tx, storeId: string, productId: string, qty: number) {
  const n = await tx.$executeRaw`
    UPDATE "InventoryItem" SET "reserved" = "reserved" + ${qty}, "updatedAt" = NOW()
    WHERE "storeId" = ${storeId} AND "productId" = ${productId} AND "onHand" - "reserved" >= ${qty}`;
  return n === 1;
}

async function releaseUnits(tx: Tx, storeId: string, productId: string, qty: number) {
  const n = await tx.$executeRaw`
    UPDATE "InventoryItem" SET "reserved" = "reserved" - ${qty}, "updatedAt" = NOW()
    WHERE "storeId" = ${storeId} AND "productId" = ${productId} AND "reserved" >= ${qty}`;
  if (n !== 1) throw new Error("Reservation release mismatch");
}

async function consumeUnits(tx: Tx, storeId: string, productId: string, qty: number) {
  const n = await tx.$executeRaw`
    UPDATE "InventoryItem" SET "onHand" = "onHand" - ${qty}, "reserved" = "reserved" - ${qty}, "updatedAt" = NOW()
    WHERE "storeId" = ${storeId} AND "productId" = ${productId} AND "reserved" >= ${qty} AND "onHand" >= ${qty}`;
  if (n !== 1) throw new Error("Reservation consume mismatch");
}

/** Releases held stock for an order (optionally one item). */
export async function releaseReservations(tx: Tx, orderId: string, orderItemId?: string) {
  const held = await tx.stockReservation.findMany({ where: { orderId, status: "HELD", ...(orderItemId ? { orderItemId } : {}) } });
  for (const r of held) {
    await releaseUnits(tx, r.storeId, r.productId, r.quantity);
    await tx.stockReservation.update({ where: { id: r.id }, data: { status: "RELEASED" } });
  }
}

/** Shrinks an item's held reservation to `keepQty` packs (pharmacist approved fewer than requested). */
export async function shrinkReservation(tx: Tx, orderItemId: string, keepQty: number) {
  const held = await tx.stockReservation.findFirst({ where: { orderItemId, status: "HELD" } });
  if (!held || held.quantity <= keepQty) return;
  await releaseUnits(tx, held.storeId, held.productId, held.quantity - keepQty);
  await tx.stockReservation.update({ where: { id: held.id }, data: { quantity: keepQty } });
}

/** Moves held stock out of inventory once the store has packed the order. */
export async function consumeReservations(tx: Tx, orderId: string) {
  const held = await tx.stockReservation.findMany({ where: { orderId, status: "HELD" } });
  for (const r of held) {
    await consumeUnits(tx, r.storeId, r.productId, r.quantity);
    await tx.stockReservation.update({ where: { id: r.id }, data: { status: "CONSUMED" } });
  }
}

/** Swaps an item's reservation to a substitute product at the same store, or throws NO_STOCK. */
export async function swapReservation(tx: Tx, orderItemId: string, substituteProductId: string, qty: number) {
  const held = await tx.stockReservation.findFirst({ where: { orderItemId, status: "HELD" } });
  if (!held) return;
  await releaseUnits(tx, held.storeId, held.productId, held.quantity);
  await tx.stockReservation.update({ where: { id: held.id }, data: { status: "RELEASED" } });
  if (!(await reserveUnits(tx, held.storeId, substituteProductId, qty))) {
    throw new DomainError("NO_STOCK", "The generic alternative is no longer in stock at the assigned store.");
  }
  await tx.stockReservation.create({
    data: { orderId: held.orderId, orderItemId, storeId: held.storeId, productId: substituteProductId, quantity: qty },
  });
}

function toPoint(p: { lat: unknown; lng: unknown }): Point {
  return { lat: Number(p.lat), lng: Number(p.lng) };
}

async function availabilityByStore(productIds: string[]) {
  const stores = await db.store.findMany({
    where: { isActive: true },
    include: { inventory: { where: { productId: { in: productIds } } } },
  });
  return stores.map((s) => ({
    storeId: s.id,
    name: s.name,
    point: toPoint(s),
    available: new Map(s.inventory.map((i) => [i.productId, i.onHand - i.reserved])),
  }));
}

/** Non-binding routing preview for checkout. The real decision happens transactionally in routeOrder. */
export async function previewRouting(localityId: string, needs: { productId: string; quantity: number }[]) {
  const locality = await db.locality.findUnique({ where: { id: localityId } });
  if (!locality) throw new DomainError("VALIDATION", "Choose your delivery area.");
  const origin = toPoint(locality);
  const stores = await availabilityByStore(needs.map((n) => n.productId));
  const choice = chooseNearestFulfillingStore(origin, stores, needs);
  const missing = needs
    .filter((n) => !stores.some((s) => (s.available.get(n.productId) ?? 0) >= n.quantity))
    .map((n) => n.productId);
  return {
    store: choice ? { id: choice.storeId, name: stores.find((s) => s.storeId === choice.storeId)!.name, distanceKm: choice.distanceKm } : null,
    /** Products no single store has in the requested quantity. */
    unavailableProductIds: missing,
  };
}

/**
 * Routes an order to the nearest active store that can supply every remaining item in full and
 * reserves the stock in the same transaction. Never splits an order. Marks NO_STOCK otherwise.
 */
export async function routeOrder(orderId: string, actor: Actor | null) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } }, deliveryLocality: true },
  });
  if (!order) throw new DomainError("NOT_FOUND", "Order not found.");
  if (order.routingStatus === "ROUTED") return { routed: true as const, storeId: order.storeId! };
  if (["REJECTED", "CANCELLED", "DELIVERED"].includes(order.status)) {
    throw new DomainError("INVALID_TRANSITION", "This order can no longer be routed.");
  }

  const rules = await loadPolicyRules(db);
  const items = order.items.filter((i) => i.status !== "REJECTED");
  for (const i of items) {
    if (!evaluateCategory(rules, i.product.category).orderable) {
      throw new DomainError("POLICY_BLOCKED", `${i.product.name} cannot be sold online and will not be routed.`);
    }
  }
  const needs = items.map((i) => ({ orderItemId: i.id, productId: i.productId, quantity: i.approvedQuantity ?? i.quantity }));
  const origin = toPoint(order.deliveryLocality);
  const stores = await availabilityByStore(needs.map((n) => n.productId));
  // Snapshot pre-filter only skips obviously short stores; the reservation below is authoritative.
  const ranked = rankStoresByDistance(origin, stores).filter((s) =>
    needs.every((n) => (s.available.get(n.productId) ?? 0) >= n.quantity),
  );

  for (const s of ranked) {
    try {
      await db.$transaction(async (tx) => {
        const claim = await tx.order.updateMany({
          where: { id: orderId, routingStatus: { not: "ROUTED" } },
          data: { routingStatus: "ROUTED", storeId: s.storeId, distanceKm: s.distanceKm.toFixed(2), routedAt: new Date() },
        });
        if (claim.count !== 1) throw new AlreadyRouted();
        for (const n of needs) {
          if (!(await reserveUnits(tx, s.storeId, n.productId, n.quantity))) throw new InsufficientStock();
          await tx.stockReservation.create({
            data: { orderId, orderItemId: n.orderItemId, storeId: s.storeId, productId: n.productId, quantity: n.quantity },
          });
        }
        await audit(tx, {
          actor,
          action: "ORDER_ROUTED",
          entityType: "Order",
          entityId: orderId,
          metadata: { storeId: s.storeId, distanceKm: Number(s.distanceKm.toFixed(2)) },
        });
      });
      return { routed: true as const, storeId: s.storeId, distanceKm: s.distanceKm };
    } catch (e) {
      if (e instanceof InsufficientStock) continue;
      if (e instanceof AlreadyRouted) {
        const current = await db.order.findUniqueOrThrow({ where: { id: orderId } });
        return { routed: true as const, storeId: current.storeId! };
      }
      throw e;
    }
  }

  await db.$transaction(async (tx) => {
    await tx.order.updateMany({ where: { id: orderId, routingStatus: { not: "ROUTED" } }, data: { routingStatus: "NO_STOCK" } });
    await audit(tx, { actor, action: "ORDER_ROUTING_NO_STOCK", entityType: "Order", entityId: orderId });
  });
  return { routed: false as const };
}

export function distanceBetween(a: { lat: unknown; lng: unknown }, b: { lat: unknown; lng: unknown }) {
  return haversineKm(toPoint(a), toPoint(b));
}
