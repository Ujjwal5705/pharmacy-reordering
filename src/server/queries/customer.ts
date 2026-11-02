import "server-only";
import type { Prisma } from "@prisma/client";
import type { Actor } from "../actor";
import { db } from "../db";
import { haversineKm } from "../domain/geo";
import { DomainError } from "../errors";
import { loadPolicyDecisions } from "../services/catalogue";
import { previewRouting } from "../services/inventory";

const NEARBY_KM = 5;

export async function cartCount(actor: Actor, familyMemberId: string | undefined) {
  if (!familyMemberId) return 0;
  const agg = await db.cartItem.aggregate({ where: { customerId: actor.id, familyMemberId }, _sum: { quantity: true } });
  return agg._sum.quantity ?? 0;
}

export async function getHome(actor: Actor, familyMemberId: string) {
  const [orders, plans, lastOrder, user] = await Promise.all([
    db.order.findMany({
      where: { customerId: actor.id, familyMemberId, status: { notIn: ["DELIVERED", "REJECTED", "CANCELLED"] } },
      include: { items: { include: { product: true } }, store: true },
      orderBy: { createdAt: "desc" },
    }),
    db.refillPlan.findMany({
      where: { customerId: actor.id, familyMemberId },
      include: { product: true, sourceOrder: { select: { orderNumber: true, id: true } } },
      orderBy: [{ runOutDate: "asc" }, { createdAt: "desc" }],
    }),
    db.order.findFirst({
      where: { customerId: actor.id, familyMemberId, status: { notIn: ["REJECTED", "CANCELLED"] } },
      orderBy: { createdAt: "desc" },
      include: { items: { where: { status: { not: "REJECTED" } }, include: { product: true } } },
    }),
    db.user.findUniqueOrThrow({ where: { id: actor.id } }),
  ]);
  // Show the latest plan per product only.
  const seen = new Set<string>();
  const latestPlans = plans
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .filter((p) => (seen.has(p.productId) ? false : (seen.add(p.productId), true)))
    .sort((a, b) => (a.runOutDate?.getTime() ?? Infinity) - (b.runOutDate?.getTime() ?? Infinity));
  return { orders, plans: latestPlans, lastOrder, profileIncomplete: !user.addressLine || !user.defaultLocalityId };
}

export async function searchCatalogue(actor: Actor, q: string) {
  const term = q.trim().slice(0, 60);
  const where: Prisma.ProductWhereInput = term
    ? { active: true, OR: [{ name: { contains: term, mode: "insensitive" } }, { molecule: { contains: term, mode: "insensitive" } }, { sku: { contains: term, mode: "insensitive" } }] }
    : { active: true };
  const [products, decisions, user, stores] = await Promise.all([
    db.product.findMany({ where, orderBy: [{ molecule: "asc" }, { isGeneric: "desc" }, { name: "asc" }], take: 60 }),
    loadPolicyDecisions(db),
    db.user.findUniqueOrThrow({ where: { id: actor.id }, include: { defaultLocality: true } }),
    db.store.findMany({ where: { isActive: true }, include: { inventory: true } }),
  ]);
  const origin = user.defaultLocality ? { lat: Number(user.defaultLocality.lat), lng: Number(user.defaultLocality.lng) } : null;
  return {
    locality: user.defaultLocality?.name ?? null,
    items: products.map((p) => {
      const stocking = stores
        .filter((s) => s.inventory.some((i) => i.productId === p.id && i.onHand - i.reserved > 0))
        .map((s) => (origin ? haversineKm(origin, { lat: Number(s.lat), lng: Number(s.lng) }) : Infinity));
      const nearest = stocking.length ? Math.min(...stocking) : null;
      const availability: "NEARBY" | "FURTHER" | "OUT" | "UNKNOWN_AREA" =
        nearest === null ? "OUT" : !origin ? "UNKNOWN_AREA" : nearest <= NEARBY_KM ? "NEARBY" : "FURTHER";
      return { product: p, decision: decisions[p.category], availability, nearestKm: nearest !== null && Number.isFinite(nearest) ? nearest : null };
    }),
  };
}

export async function getCart(actor: Actor, familyMemberId: string) {
  const [items, decisions] = await Promise.all([
    db.cartItem.findMany({ where: { customerId: actor.id, familyMemberId }, include: { product: true }, orderBy: { createdAt: "asc" } }),
    loadPolicyDecisions(db),
  ]);
  const lines = items.map((i) => ({ ...i, decision: decisions[i.product.category] }));
  return {
    lines,
    subtotal: lines.reduce((s, l) => s + l.product.pricePaise * l.quantity, 0),
    needsPrescription: lines.some((l) => l.decision.prescriptionRequired),
    blocked: lines.filter((l) => !l.decision.orderable),
  };
}

export async function getCheckout(actor: Actor, familyMemberId: string, opts: { localityId?: string; prescriptionId?: string }) {
  const cart = await getCart(actor, familyMemberId);
  const [user, localities, prescriptions] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: actor.id } }),
    db.locality.findMany({ orderBy: { name: "asc" } }),
    db.prescription.findMany({
      where: { customerId: actor.id, familyMemberId, status: "ACTIVE" },
      include: {
        extractionRuns: { orderBy: { createdAt: "desc" }, take: 1, include: { lines: { orderBy: { lineIndex: "asc" }, include: { matchedProduct: true } }, fields: true } },
        reviews: { orderBy: { createdAt: "desc" }, take: 1, select: { outcome: true, createdAt: true } },
      },
      orderBy: { uploadedAt: "desc" },
      take: 6,
    }),
  ]);
  const localityId = opts.localityId && localities.some((l) => l.id === opts.localityId) ? opts.localityId : (user.defaultLocalityId ?? null);
  const selectedRx = prescriptions.find((p) => p.id === opts.prescriptionId) ?? null;
  const routing =
    localityId && cart.lines.length
      ? await previewRouting(localityId, cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })))
      : null;
  return { cart, user, localities, localityId, prescriptions, selectedRx, routing };
}

export async function listOrders(actor: Actor) {
  return db.order.findMany({
    where: { customerId: actor.id },
    include: { familyMember: true, items: { include: { product: true } }, store: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getOrderDetail(actor: Actor, orderId: string) {
  const order = await db.order.findFirst({
    where: { id: orderId, customerId: actor.id },
    include: {
      familyMember: true,
      store: true,
      deliveryLocality: true,
      payment: true,
      items: { include: { product: true, requestedProduct: true } },
      events: { orderBy: { createdAt: "asc" } },
      reviews: { orderBy: { createdAt: "desc" }, select: { outcome: true, reason: true, createdAt: true, items: { select: { orderItemId: true, decision: true, reason: true } } } },
      proposals: { include: { originalProduct: true, substituteProduct: true }, orderBy: { createdAt: "desc" } },
      refillPlans: { include: { product: true } },
      prescription: { select: { id: true, uploadedAt: true, mimeType: true } },
    },
  });
  if (!order) throw new DomainError("NOT_FOUND", "Order not found.");
  return order;
}

export async function getFamily(actor: Actor) {
  const [user, members, localities] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: actor.id } }),
    db.familyMember.findMany({ where: { customerId: actor.id }, orderBy: { createdAt: "asc" }, include: { _count: { select: { orders: true } } } }),
    db.locality.findMany({ orderBy: { name: "asc" } }),
  ]);
  return { user, members, localities };
}
