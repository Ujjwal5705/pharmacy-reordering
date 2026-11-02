import "server-only";
import type { OrderStatus, Prisma } from "@prisma/client";
import { assertRole, canAccessStore, type Actor } from "../actor";
import { db } from "../db";
import { evaluateDispatchGate } from "../domain/gates";
import { DomainError } from "../errors";
import { loadPolicyDecisions } from "../services/catalogue";
import { loadGateOrder } from "../services/orders";

/** Pharmacists bound to a store only see that store's orders; central pharmacists see all. */
function pharmacistScope(actor: Actor): Prisma.OrderWhereInput {
  return actor.storeId ? { storeId: actor.storeId } : {};
}

export const QUEUE_VIEWS = {
  waiting: { label: "Awaiting decision", statuses: ["AWAITING_PHARMACIST"] as OrderStatus[] },
  onhold: { label: "Re-upload requested", statuses: ["NEEDS_REUPLOAD"] as OrderStatus[] },
  consent: { label: "Awaiting customer consent", statuses: ["AWAITING_CUSTOMER_CONSENT"] as OrderStatus[] },
  decided: { label: "Decided today", statuses: ["APPROVED", "REJECTED", "PICKING", "PACKED", "HANDED_TO_DELIVERY", "DELIVERED"] as OrderStatus[] },
};
export type QueueView = keyof typeof QUEUE_VIEWS;

export async function getPharmacistQueue(actor: Actor, view: QueueView, storeId?: string) {
  assertRole(actor, ["PHARMACIST"]);
  const v = QUEUE_VIEWS[view];
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const where: Prisma.OrderWhereInput = {
    ...pharmacistScope(actor),
    status: { in: v.statuses },
    requiresPharmacist: true,
    ...(view === "decided" ? { firstDecisionAt: { gte: startOfDay } } : {}),
    ...(storeId && !actor.storeId ? { storeId } : {}),
  };
  const [orders, counts, stores] = await Promise.all([
    db.order.findMany({
      where,
      include: {
        familyMember: true,
        store: true,
        items: { include: { product: true } },
        prescription: { include: { extractionRuns: { orderBy: { createdAt: "desc" }, take: 1 } } },
      },
      orderBy: view === "decided" ? { firstDecisionAt: "desc" } : { submittedAt: "asc" },
      take: 100,
    }),
    db.order.groupBy({
      by: ["status"],
      where: { ...pharmacistScope(actor), requiresPharmacist: true, status: { in: ["AWAITING_PHARMACIST", "NEEDS_REUPLOAD", "AWAITING_CUSTOMER_CONSENT"] } },
      _count: true,
    }),
    db.store.findMany({ orderBy: { name: "asc" } }),
  ]);
  return {
    orders,
    stores: actor.storeId ? stores.filter((s) => s.id === actor.storeId) : stores,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<OrderStatus, number>>,
  };
}

export async function getReviewContext(actor: Actor, orderId: string) {
  assertRole(actor, ["PHARMACIST"]);
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      familyMember: true,
      customer: { select: { name: true, addressLine: true } },
      deliveryLocality: true,
      store: true,
      items: { include: { product: true, h1Entry: true, decisions: true } },
      prescription: {
        include: {
          extractionRuns: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { lines: { orderBy: { lineIndex: "asc" }, include: { matchedProduct: true } }, fields: true },
          },
        },
      },
      reviews: { orderBy: { createdAt: "desc" }, include: { reviewer: { select: { name: true } }, items: true } },
      proposals: { include: { substituteProduct: true, originalProduct: true, consent: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order || !order.requiresPharmacist || !canAccessStore(actor, order.storeId)) {
    throw new DomainError("NOT_FOUND", "Order not found in your queue.");
  }
  const groups = order.items.map((i) => i.product.genericGroup).filter((g): g is string => Boolean(g));
  const [alternatives, decisions, audit] = await Promise.all([
    db.product.findMany({
      where: { genericGroup: { in: groups }, active: true },
      include: order.storeId ? { inventory: { where: { storeId: order.storeId } } } : undefined,
      orderBy: { pricePaise: "asc" },
    }),
    loadPolicyDecisions(db),
    db.auditEvent.findMany({
      where: {
        OR: [
          { entityType: "Order", entityId: order.id },
          ...(order.prescriptionId ? [{ entityType: "Prescription", entityId: order.prescriptionId }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);
  const actorIds = [...new Set(audit.map((a) => a.actorId).filter((x): x is string => Boolean(x)))];
  const actors = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const names = new Map(actors.map((a) => [a.id, a.name]));
  return {
    order,
    alternatives: alternatives.map((p) => ({
      id: p.id,
      name: p.name,
      genericGroup: p.genericGroup,
      isGeneric: p.isGeneric,
      pricePaise: p.pricePaise,
      category: p.category,
      orderable: decisions[p.category].orderable,
      available: "inventory" in p && Array.isArray(p.inventory) ? p.inventory.reduce((s: number, i: { onHand: number; reserved: number }) => s + i.onHand - i.reserved, 0) : null,
    })),
    audit: audit.map((a) => ({ ...a, actorName: a.actorId ? (names.get(a.actorId) ?? "Unknown") : "System" })),
  };
}

const STORE_STATUSES: OrderStatus[] = ["AWAITING_PHARMACIST", "NEEDS_REUPLOAD", "AWAITING_CUSTOMER_CONSENT", "APPROVED", "PICKING", "PACKED", "HANDED_TO_DELIVERY"];

export async function getStoreQueue(actor: Actor, requestedStoreId?: string) {
  assertRole(actor, ["STORE_STAFF", "OPS_ADMIN"]);
  const stores = await db.store.findMany({ orderBy: { name: "asc" } });
  const storeId = actor.role === "STORE_STAFF" ? actor.storeId : (requestedStoreId ?? stores[0]?.id ?? null);
  if (!storeId) throw new DomainError("FORBIDDEN", "Your account is not linked to a store.");
  const orders = await db.order.findMany({
    where: { storeId, status: { in: STORE_STATUSES } },
    include: { items: { include: { product: true } }, deliveryLocality: true, familyMember: { select: { name: true } } },
    orderBy: { submittedAt: "asc" },
  });
  const deliveredToday = await db.order.count({ where: { storeId, status: "DELIVERED", deliveredAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } });
  // Dispatch gate result per ready order, so the UI can explain any block before staff try.
  const gates = new Map<string, string[]>();
  for (const o of orders.filter((o) => ["APPROVED", "PICKING", "PACKED", "HANDED_TO_DELIVERY"].includes(o.status))) {
    gates.set(o.id, evaluateDispatchGate(await loadGateOrder(db, o.id)).violations);
  }
  return { store: stores.find((s) => s.id === storeId)!, stores: actor.role === "OPS_ADMIN" ? stores : [], orders, gates, deliveredToday };
}

export async function getOpsDashboard(actor: Actor) {
  assertRole(actor, ["OPS_ADMIN"]);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [stores, byStore, decided, rejections, itemRejections, noStock, imports, notifications] = await Promise.all([
    db.store.findMany({ orderBy: { name: "asc" } }),
    db.order.groupBy({ by: ["storeId", "status"], _count: true, where: { createdAt: { gte: since } } }),
    db.order.findMany({ where: { firstDecisionAt: { not: null }, submittedAt: { gte: since } }, select: { submittedAt: true, firstDecisionAt: true, storeId: true } }),
    db.pharmacistReview.findMany({
      where: { outcome: { in: ["REJECTED", "REUPLOAD_REQUESTED"] }, createdAt: { gte: since } },
      include: { order: { select: { orderNumber: true, id: true, store: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.reviewItemDecision.count({ where: { decision: "REJECT", review: { createdAt: { gte: since } } } }),
    db.order.findMany({
      where: { routingStatus: "NO_STOCK", status: { notIn: ["REJECTED", "CANCELLED", "DELIVERED"] } },
      include: { items: { include: { product: true } }, deliveryLocality: true },
      orderBy: { submittedAt: "asc" },
    }),
    db.stockImportBatch.findMany({ orderBy: { createdAt: "desc" }, take: 3 }),
    db.notificationLog.count({ where: { createdAt: { gte: since } } }),
  ]);
  const minutes = decided.map((o) => (o.firstDecisionAt!.getTime() - o.submittedAt.getTime()) / 60_000).sort((a, b) => a - b);
  const median = minutes.length ? (minutes.length % 2 ? minutes[(minutes.length - 1) / 2] : (minutes[minutes.length / 2 - 1] + minutes[minutes.length / 2]) / 2) : null;
  const awaiting = await db.order.count({ where: { status: "AWAITING_PHARMACIST" } });
  return { stores, byStore, median, decidedCount: minutes.length, overTarget: minutes.filter((m) => m > 10).length, rejections, itemRejections, noStock, imports, awaiting, notifications };
}
