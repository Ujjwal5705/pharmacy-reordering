import type { OrderSource, OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { z } from "zod";
import { assertRole, canAccessStore, type Actor } from "../actor";
import { audit } from "../audit";
import { db, type DbClient, type Tx } from "../db";
import { evaluateApprovalGate, evaluateDispatchGate, type GateOrder } from "../domain/gates";
import { assertTransition, type TransitionActor } from "../domain/order-state";
import { evaluateCategory } from "../domain/policy";
import { DomainError } from "../errors";
import { loadPolicyRules } from "./catalogue";
import { consumeReservations, releaseReservations, routeOrder } from "./inventory";
import { notify } from "./notifications";
import { collectCodOnDelivery, createTestPayment, voidTestPayment } from "./payments";
import { startRefillPlans } from "./refills";

// ───────────────────────────── shared helpers ─────────────────────────────

/** Builds the gate snapshot from the database: live policy, reviews, H1 entries, consents, stock. */
export async function loadGateOrder(client: DbClient, orderId: string, at: Date = new Date()): Promise<GateOrder> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: true,
          h1Entry: true,
          reservations: { where: { status: { in: ["HELD", "CONSUMED"] } } },
          proposals: { include: { consent: true, proposedBy: true } },
        },
      },
      proposals: { where: { status: "PENDING_CONSENT" } },
      reviews: { include: { reviewer: true } },
    },
  });
  if (!order) throw new DomainError("NOT_FOUND", "Order not found.");
  const rules = await loadPolicyRules(client);
  // Only reviews written by an active registered pharmacist count as approvals.
  const validReviewIds = new Set(
    order.reviews
      .filter((r) => r.reviewer.role === "PHARMACIST" && r.reviewer.active && Boolean(r.reviewerRegNo))
      .map((r) => r.id),
  );
  return {
    status: order.status,
    routingStatus: order.routingStatus,
    storeId: order.storeId,
    prescriptionId: order.prescriptionId,
    hasPendingSubstitution: order.proposals.length > 0,
    items: order.items.map((i) => ({
      id: i.id,
      label: `${i.product.name}`,
      status: i.status,
      prescriptionRequired: i.prescriptionRequired,
      pharmacistApprovalRequired: i.pharmacistApprovalRequired,
      h1RegisterRequired: i.h1RegisterRequired,
      approvedByReviewId: i.approvedByReviewId && validReviewIds.has(i.approvedByReviewId) ? i.approvedByReviewId : null,
      hasH1Entry: Boolean(i.h1Entry),
      substituted: i.productId !== i.requestedProductId,
      substitutionConsented: i.proposals.some(
        (p) =>
          p.status === "ACCEPTED" &&
          p.substituteProductId === i.productId &&
          p.proposedBy.role === "PHARMACIST" &&
          p.consent?.granted === true &&
          p.consent.customerId === order.customerId,
      ),
      livePolicy: evaluateCategory(rules, i.product.category, at),
      allocatedQty: i.reservations.filter((r) => r.productId === i.productId).reduce((s, r) => s + r.quantity, 0),
      approvedQuantity: i.approvedQuantity,
      quantity: i.quantity,
    })),
  };
}

/** Locks the order row for the rest of the transaction (serialises concurrent actions on one order). */
export async function lockOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw new DomainError("NOT_FOUND", "Order not found.");
  return order;
}

export async function transitionOrder(
  tx: Tx,
  order: { id: string; status: OrderStatus },
  to: OrderStatus,
  actorKind: TransitionActor,
  actor: Actor | null,
  opts: { note?: string; data?: Prisma.OrderUncheckedUpdateManyInput } = {},
) {
  assertTransition(order.status, to, actorKind);
  const res = await tx.order.updateMany({
    where: { id: order.id, status: order.status },
    data: { status: to, ...opts.data },
  });
  if (res.count !== 1) {
    throw new DomainError("CONFLICT", "This order was just updated by someone else. Refresh and try again.");
  }
  await tx.orderStatusEvent.create({
    data: { orderId: order.id, fromStatus: order.status, toStatus: to, actorId: actor?.id, actorRole: actor?.role ?? "SYSTEM", note: opts.note },
  });
  await audit(tx, {
    actor,
    action: "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: order.id,
    metadata: { from: order.status, to },
  });
}

export async function assertApprovalGate(tx: Tx, orderId: string) {
  const gate = evaluateApprovalGate(await loadGateOrder(tx, orderId));
  if (!gate.allowed) throw new DomainError("APPROVAL_BLOCKED", "This order cannot be approved yet.", gate.violations);
}

async function nextOrderNumber(tx: Tx) {
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_number_seq') AS n`;
  return `RX-${row.n.toString()}`;
}

// ───────────────────────────── customer: submit ─────────────────────────────

export const submitOrderSchema = z.object({
  familyMemberId: z.string().min(1),
  localityId: z.string().min(1, "Choose your delivery area."),
  deliveryAddress: z.string().trim().min(6, "Enter a delivery address.").max(200),
  paymentMethod: z.enum(["UPI_TEST", "COD_TEST"]),
  prescriptionId: z.string().min(1).nullable(),
  source: z.enum(["CATALOGUE", "REORDER", "REFILL_REMINDER"]).default("CATALOGUE"),
});
export type SubmitOrderInput = z.infer<typeof submitOrderSchema>;

/**
 * Turns the patient's cart into an order. Blocks non-orderable categories, requires a prescription
 * when any item needs one, and sends every prescription item to the pharmacist queue. Routing to a
 * store with stock happens right after, in its own transactions.
 */
export async function submitOrder(actor: Actor | null, raw: SubmitOrderInput) {
  assertRole(actor, ["CUSTOMER"]);
  const input = submitOrderSchema.parse(raw);

  const member = await db.familyMember.findFirst({ where: { id: input.familyMemberId, customerId: actor.id } });
  if (!member) throw new DomainError("NOT_FOUND", "Patient profile not found.");
  const locality = await db.locality.findUnique({ where: { id: input.localityId } });
  if (!locality) throw new DomainError("VALIDATION", "Choose your delivery area.");

  const cart = await db.cartItem.findMany({ where: { customerId: actor.id, familyMemberId: member.id }, include: { product: true } });
  if (cart.length === 0) throw new DomainError("VALIDATION", "The cart is empty.");

  const rules = await loadPolicyRules(db);
  const lines = cart.map((c) => ({ c, decision: evaluateCategory(rules, c.product.category) }));
  const blocked = lines.filter((l) => !l.decision.orderable || !l.c.product.active);
  if (blocked.length) {
    throw new DomainError(
      "POLICY_BLOCKED",
      "Some items cannot be ordered online. Remove them to continue.",
      blocked.map((b) => b.c.product.name),
    );
  }

  const needsRx = lines.some((l) => l.decision.prescriptionRequired);
  let prescription = null;
  if (input.prescriptionId) {
    prescription = await db.prescription.findFirst({
      where: { id: input.prescriptionId, customerId: actor.id, familyMemberId: member.id, status: "ACTIVE" },
      include: { extractionRuns: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!prescription) throw new DomainError("NOT_FOUND", "Prescription not found for this patient.");
  }
  if (needsRx && !prescription) {
    throw new DomainError("VALIDATION", "A prescription is required for one or more items. Upload it to continue.");
  }

  const requiresPharmacist = lines.some((l) => l.decision.pharmacistApprovalRequired);
  const latestRun = prescription?.extractionRuns[0];
  const manualReviewRequired = Boolean(prescription) && latestRun?.status !== "SUCCEEDED";
  const subtotal = lines.reduce((s, l) => s + l.c.product.pricePaise * l.c.quantity, 0);

  const order = await db.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNumber: await nextOrderNumber(tx),
        customerId: actor.id,
        familyMemberId: member.id,
        status: requiresPharmacist ? "AWAITING_PHARMACIST" : "APPROVED",
        approvedAt: requiresPharmacist ? null : new Date(),
        source: input.source as OrderSource,
        deliveryLocalityId: locality.id,
        deliveryAddress: input.deliveryAddress,
        subtotalPaise: subtotal,
        requiresPharmacist,
        manualReviewRequired,
        prescriptionId: prescription?.id ?? null,
        items: {
          create: lines.map(({ c, decision }) => ({
            productId: c.productId,
            requestedProductId: c.productId,
            quantity: c.quantity,
            unitPricePaise: c.product.pricePaise,
            status: decision.pharmacistApprovalRequired ? "PENDING_REVIEW" : "NOT_REQUIRED",
            category: c.product.category,
            policyId: decision.policyId!,
            prescriptionRequired: decision.prescriptionRequired,
            pharmacistApprovalRequired: decision.pharmacistApprovalRequired,
            h1RegisterRequired: decision.h1RegisterRequired,
          })),
        },
      },
    });
    await tx.orderStatusEvent.create({
      data: { orderId: created.id, toStatus: created.status, actorId: actor.id, actorRole: actor.role, note: "Order submitted" },
    });
    await createTestPayment(tx, created.id, input.paymentMethod as PaymentMethod, subtotal);
    await tx.cartItem.deleteMany({ where: { customerId: actor.id, familyMemberId: member.id } });
    await audit(tx, {
      actor,
      action: "ORDER_SUBMITTED",
      entityType: "Order",
      entityId: created.id,
      metadata: { orderNumber: created.orderNumber, items: lines.length, requiresPharmacist, manualReviewRequired },
    });
    await notify(tx, actor.id, "ORDER_SUBMITTED", { orderNumber: created.orderNumber });
    return created;
  });

  const routing = await routeOrder(order.id, actor);
  return { orderId: order.id, orderNumber: order.orderNumber, routed: routing.routed };
}

// ───────────────────────────── customer: cancel / re-upload ─────────────────────────────

export async function cancelOrder(actor: Actor | null, orderId: string, reason: string) {
  assertRole(actor, ["CUSTOMER", "OPS_ADMIN"]);
  const note = z.string().trim().min(3, "Give a short reason.").max(300).parse(reason);
  await db.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (actor.role === "CUSTOMER" && order.customerId !== actor.id) throw new DomainError("NOT_FOUND", "Order not found.");
    await transitionOrder(tx, order, "CANCELLED", actor.role, actor, { note, data: { cancelledAt: new Date() } });
    await releaseReservations(tx, orderId);
    await voidTestPayment(tx, orderId);
    await tx.substitutionProposal.updateMany({ where: { orderId, status: "PENDING_CONSENT" }, data: { status: "DECLINED", decidedAt: new Date() } });
  });
}

/** Attaches a newly uploaded prescription to an order on hold and returns it to the pharmacist queue. */
export async function reuploadPrescription(actor: Actor | null, orderId: string, prescriptionId: string) {
  assertRole(actor, ["CUSTOMER"]);
  await db.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.customerId !== actor.id) throw new DomainError("NOT_FOUND", "Order not found.");
    const rx = await tx.prescription.findFirst({
      where: { id: prescriptionId, customerId: actor.id, familyMemberId: order.familyMemberId, status: "ACTIVE" },
      include: { extractionRuns: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!rx) throw new DomainError("NOT_FOUND", "Prescription not found for this patient.");
    if (rx.id === order.prescriptionId) throw new DomainError("VALIDATION", "Upload a new photo of the prescription.");
    if (order.prescriptionId) {
      await tx.prescription.update({ where: { id: order.prescriptionId }, data: { status: "SUPERSEDED" } });
    }
    await transitionOrder(tx, order, "AWAITING_PHARMACIST", "CUSTOMER", actor, {
      note: "New prescription uploaded",
      data: { prescriptionId: rx.id, manualReviewRequired: rx.extractionRuns[0]?.status !== "SUCCEEDED" },
    });
  });
}

// ───────────────────────────── store: fulfilment ─────────────────────────────

export const fulfilmentSchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("START_PICKING") }),
  z.object({
    step: z.literal("MARK_PACKED"),
    storeInvoiceNumber: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9\-/]{2,29}$/, "Invoice number: 3–30 letters, digits, - or /."),
  }),
  z.object({ step: z.literal("HAND_OVER"), deliveryPartner: z.string().trim().min(2, "Enter who collected the order.").max(60) }),
  z.object({ step: z.literal("MARK_DELIVERED") }),
]);
export type FulfilmentInput = z.infer<typeof fulfilmentSchema>;

const STEP_TARGET: Record<FulfilmentInput["step"], OrderStatus> = {
  START_PICKING: "PICKING",
  MARK_PACKED: "PACKED",
  HAND_OVER: "HANDED_TO_DELIVERY",
  MARK_DELIVERED: "DELIVERED",
};

/**
 * Pick → pack (store invoice) → hand over → delivered. The dispatch gate (pharmacist approval,
 * H1 register, consent, live policy, routed stock) is re-checked at every step inside the lock.
 */
export async function advanceFulfilment(actor: Actor | null, orderId: string, raw: FulfilmentInput) {
  assertRole(actor, ["STORE_STAFF", "OPS_ADMIN"]);
  const input = fulfilmentSchema.parse(raw);
  const to = STEP_TARGET[input.step];

  await db.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!canAccessStore(actor, order.storeId)) throw new DomainError("FORBIDDEN", "This order belongs to another store.");
    assertTransition(order.status, to, actor.role);
    const gate = evaluateDispatchGate(await loadGateOrder(tx, orderId));
    if (!gate.allowed) throw new DomainError("DISPATCH_BLOCKED", "This order cannot be dispatched.", gate.violations);

    const now = new Date();
    const data: Prisma.OrderUncheckedUpdateManyInput = {};
    if (input.step === "START_PICKING") data.pickedAt = now;
    if (input.step === "MARK_PACKED") Object.assign(data, { packedAt: now, storeInvoiceNumber: input.storeInvoiceNumber });
    if (input.step === "HAND_OVER") Object.assign(data, { handedOverAt: now, deliveryPartner: input.deliveryPartner });
    if (input.step === "MARK_DELIVERED") data.deliveredAt = now;

    await transitionOrder(tx, order, to, actor.role, actor, { data });
    if (input.step === "MARK_PACKED") await consumeReservations(tx, orderId);
    if (input.step === "HAND_OVER") await notify(tx, order.customerId, "OUT_FOR_DELIVERY", { orderNumber: order.orderNumber });
    if (input.step === "MARK_DELIVERED") {
      await collectCodOnDelivery(tx, orderId);
      await startRefillPlans(tx, orderId, now);
      await notify(tx, order.customerId, "ORDER_DELIVERED", { orderNumber: order.orderNumber });
    }
  });
}

/** Operations: retry routing for an order that had no single store with stock. */
export async function retryRouting(actor: Actor | null, orderId: string) {
  assertRole(actor, ["OPS_ADMIN"]);
  return routeOrder(orderId, actor);
}
