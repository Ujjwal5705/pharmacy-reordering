import { z } from "zod";
import { assertRegisteredPharmacist, assertRole, canAccessStore, type Actor } from "../actor";
import { audit } from "../audit";
import { db, type Tx } from "../db";
import { MAX_UNITS_PER_DAY } from "../domain/refill";
import { evaluateCategory } from "../domain/policy";
import { DomainError } from "../errors";
import { loadPolicyRules } from "./catalogue";
import { releaseReservations, shrinkReservation, swapReservation } from "./inventory";
import { assertApprovalGate, lockOrder, transitionOrder } from "./orders";
import { notify } from "./notifications";
import { adjustTestPayment, voidTestPayment } from "./payments";
import { createRefillPlans } from "./refills";

export const GENERIC_CONSENT_TEXT_VERSION = "generic-substitution-v1";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()) && d.getTime() <= Date.now(), "Prescription date cannot be in the future.");
const reason = z.string().trim().min(5, "Give the customer a clear reason (at least 5 characters).").max(300);
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((s) => (s ? s : undefined));

const h1Schema = z.object({
  patientName: z.string().trim().min(2, "H1 register: patient name is required.").max(120),
  patientAddress: z.string().trim().min(5, "H1 register: patient address is required.").max(200),
  prescriberName: z.string().trim().min(3, "H1 register: prescriber name is required.").max(120),
  prescriberAddress: z.string().trim().min(5, "H1 register: prescriber address is required.").max(200),
  prescriberRegNo: optionalText(40),
});

const itemDecisionSchema = z.object({
  orderItemId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT", "PROPOSE_SUBSTITUTE"]),
  approvedQuantity: z.coerce.number().int().min(1).max(20).optional(),
  unitsPerDay: z.coerce.number().positive().max(MAX_UNITS_PER_DAY).optional(),
  dosageInstruction: optionalText(200),
  reason: optionalText(300),
  substituteProductId: optionalText(40),
  h1: h1Schema.optional(),
});

export const reviewSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("REQUEST_REUPLOAD"), reason }),
  z.object({ outcome: z.literal("REJECT_ORDER"), reason }),
  z.object({
    outcome: z.literal("DECIDE"),
    header: z.object({
      patientName: optionalText(120),
      prescriberName: optionalText(120),
      prescriberRegNo: optionalText(40),
      prescriptionDate: isoDate.optional(),
    }),
    items: z.array(itemDecisionSchema).min(1),
  }),
]);
export type ReviewInput = z.input<typeof reviewSchema>;

async function loadOrderForReview(actor: Actor, orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } }, prescription: { include: { extractionRuns: { orderBy: { createdAt: "desc" }, take: 1 } } } },
  });
  if (!order || !canAccessStore(actor, order.storeId)) throw new DomainError("NOT_FOUND", "Order not found in your queue.");
  return order;
}

/**
 * Records a pharmacist's decision. Only a registered pharmacist in scope can call this; the
 * extraction draft is reference material only and is never read as a decision.
 */
export async function submitReview(actor: Actor | null, orderId: string, raw: ReviewInput) {
  assertRegisteredPharmacist(actor);
  const input = reviewSchema.parse(raw);
  const order = await loadOrderForReview(actor, orderId);
  const extractionRunId = order.prescription?.extractionRuns[0]?.id ?? null;
  const rules = await loadPolicyRules(db);

  await db.$transaction(async (tx) => {
    const locked = await lockOrder(tx, orderId);
    if (locked.status !== "AWAITING_PHARMACIST") {
      throw new DomainError("CONFLICT", "This order is no longer waiting for a pharmacist decision.");
    }
    const now = new Date();
    const firstDecisionAt = locked.firstDecisionAt ?? now;
    const base = { orderId, prescriptionId: locked.prescriptionId, extractionRunId, reviewerId: actor.id, reviewerRegNo: actor.pharmacistRegNo! };

    if (input.outcome === "REQUEST_REUPLOAD") {
      const review = await tx.pharmacistReview.create({ data: { ...base, outcome: "REUPLOAD_REQUESTED", reason: input.reason } });
      await transitionOrder(tx, locked, "NEEDS_REUPLOAD", "PHARMACIST", actor, { note: input.reason, data: { firstDecisionAt } });
      await audit(tx, { actor, action: "PRESCRIPTION_REVIEW_SUBMITTED", entityType: "Order", entityId: orderId, metadata: { reviewId: review.id, outcome: "REUPLOAD_REQUESTED" } });
      await notify(tx, locked.customerId, "REUPLOAD_REQUESTED", { orderNumber: locked.orderNumber });
      return;
    }

    if (input.outcome === "REJECT_ORDER") {
      const review = await tx.pharmacistReview.create({ data: { ...base, outcome: "REJECTED", reason: input.reason } });
      await tx.orderItem.updateMany({ where: { orderId }, data: { status: "REJECTED" } });
      await transitionOrder(tx, locked, "REJECTED", "PHARMACIST", actor, { note: input.reason, data: { firstDecisionAt, rejectionReason: input.reason } });
      await releaseReservations(tx, orderId);
      await voidTestPayment(tx, orderId);
      await audit(tx, { actor, action: "PRESCRIPTION_REVIEW_SUBMITTED", entityType: "Order", entityId: orderId, metadata: { reviewId: review.id, outcome: "REJECTED" } });
      await notify(tx, locked.customerId, "ORDER_REJECTED", { orderNumber: locked.orderNumber });
      return;
    }

    // ── DECIDE: one decision per item that needs pharmacist approval ──
    const pending = order.items.filter((i) => i.status === "PENDING_REVIEW");
    const decided = new Map(input.items.map((d) => [d.orderItemId, d]));
    if (decided.size !== input.items.length || pending.length !== decided.size || pending.some((i) => !decided.has(i.id))) {
      throw new DomainError("VALIDATION", "Record a decision for every item that needs pharmacist approval.");
    }

    const errors: string[] = [];
    const approvingRx = pending.some((i) => decided.get(i.id)!.decision !== "REJECT" && i.prescriptionRequired);
    if (approvingRx) {
      if (!locked.prescriptionId) errors.push("No prescription is attached to this order.");
      if (!input.header.prescriberName) errors.push("Confirm the prescriber's name from the prescription.");
      if (!input.header.prescriptionDate) errors.push("Confirm the prescription date.");
    }
    for (const item of pending) {
      const d = decided.get(item.id)!;
      const name = item.product.name;
      if (d.decision === "REJECT") {
        if (!d.reason || d.reason.length < 5) errors.push(`${name}: give a reason for rejecting this item.`);
        continue;
      }
      if (d.approvedQuantity !== undefined && d.approvedQuantity > item.quantity) {
        errors.push(`${name}: approved quantity cannot exceed the ${item.quantity} requested.`);
      }
      if (item.h1RegisterRequired && !d.h1) errors.push(`${name}: complete the H1 register details.`);
      if (d.decision === "PROPOSE_SUBSTITUTE") {
        const sub = d.substituteProductId ? await tx.product.findUnique({ where: { id: d.substituteProductId } }) : null;
        if (!sub || sub.id === item.productId || !sub.active || !sub.isGeneric || !item.product.genericGroup || sub.genericGroup !== item.product.genericGroup) {
          errors.push(`${name}: choose an equivalent generic product (same medicine, strength and form) as the alternative.`);
        } else if (!evaluateCategory(rules, sub.category).orderable || sub.category !== item.category) {
          errors.push(`${name}: the alternative cannot be supplied online.`);
        }
      }
    }
    if (errors.length) throw new DomainError("VALIDATION", "The review is incomplete.", errors);

    const decisions = pending.map((i) => decided.get(i.id)!.decision);
    const anySub = decisions.includes("PROPOSE_SUBSTITUTE");
    const allRejected = decisions.every((d) => d === "REJECT") && order.items.every((i) => i.status !== "NOT_REQUIRED");
    const someRejected = decisions.includes("REJECT");
    const outcome = anySub ? "SUBSTITUTION_PROPOSED" : allRejected ? "REJECTED" : someRejected ? "PARTIALLY_APPROVED" : "APPROVED";

    const review = await tx.pharmacistReview.create({
      data: {
        ...base,
        outcome,
        patientName: input.header.patientName,
        prescriberName: input.header.prescriberName,
        prescriberRegNo: input.header.prescriberRegNo,
        prescriptionDate: input.header.prescriptionDate,
      },
    });

    for (const item of pending) {
      const d = decided.get(item.id)!;
      const approvedQuantity = d.decision === "REJECT" ? null : (d.approvedQuantity ?? item.quantity);
      await tx.reviewItemDecision.create({
        data: {
          reviewId: review.id,
          orderItemId: item.id,
          decision: d.decision,
          approvedQuantity,
          unitsPerDay: d.unitsPerDay,
          dosageInstruction: d.dosageInstruction,
          reason: d.reason,
          substituteProductId: d.decision === "PROPOSE_SUBSTITUTE" ? d.substituteProductId : null,
        },
      });
      if (d.decision === "REJECT") {
        await tx.orderItem.update({ where: { id: item.id }, data: { status: "REJECTED" } });
        await releaseReservations(tx, orderId, item.id);
        continue;
      }
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          status: d.decision === "APPROVE" ? "APPROVED" : "AWAITING_CONSENT",
          approvedQuantity,
          unitsPerDay: d.unitsPerDay ?? null,
          dosageInstruction: d.dosageInstruction ?? null,
          approvedByReviewId: review.id,
        },
      });
      if (approvedQuantity! < item.quantity) await shrinkReservation(tx, item.id, approvedQuantity!);
      if (item.h1RegisterRequired && d.h1) {
        const entry = {
          orderId,
          productId: d.decision === "PROPOSE_SUBSTITUTE" ? d.substituteProductId! : item.productId,
          patientName: d.h1.patientName,
          patientAddress: d.h1.patientAddress,
          prescriberName: d.h1.prescriberName,
          prescriberAddress: d.h1.prescriberAddress,
          prescriberRegNo: d.h1.prescriberRegNo ?? null,
          prescriptionDate: input.header.prescriptionDate!,
          quantitySupplied: approvedQuantity!,
          recordedById: actor.id,
        };
        // A re-review (e.g. after a declined substitution) replaces the earlier entry for this item.
        await tx.h1RegisterEntry.upsert({ where: { orderItemId: item.id }, create: { ...entry, orderItemId: item.id }, update: entry });
        await audit(tx, { actor, action: "H1_REGISTER_RECORDED", entityType: "OrderItem", entityId: item.id });
      }
      if (d.decision === "PROPOSE_SUBSTITUTE") {
        const proposal = await tx.substitutionProposal.create({
          data: {
            orderId,
            orderItemId: item.id,
            reviewId: review.id,
            originalProductId: item.productId,
            substituteProductId: d.substituteProductId!,
            proposedById: actor.id,
          },
        });
        await audit(tx, { actor, action: "SUBSTITUTION_PROPOSED", entityType: "SubstitutionProposal", entityId: proposal.id });
      }
    }

    await recalculateSubtotal(tx, orderId);
    await audit(tx, { actor, action: "PRESCRIPTION_REVIEW_SUBMITTED", entityType: "Order", entityId: orderId, metadata: { reviewId: review.id, outcome } });

    if (outcome === "SUBSTITUTION_PROPOSED") {
      await transitionOrder(tx, locked, "AWAITING_CUSTOMER_CONSENT", "PHARMACIST", actor, { note: "Generic alternative proposed", data: { firstDecisionAt } });
      await notify(tx, locked.customerId, "CONSENT_REQUESTED", { orderNumber: locked.orderNumber });
    } else if (outcome === "REJECTED") {
      await transitionOrder(tx, locked, "REJECTED", "PHARMACIST", actor, { note: "All items rejected", data: { firstDecisionAt, rejectionReason: "All items rejected by pharmacist" } });
      await releaseReservations(tx, orderId);
      await voidTestPayment(tx, orderId);
      await notify(tx, locked.customerId, "ORDER_REJECTED", { orderNumber: locked.orderNumber });
    } else {
      await assertApprovalGate(tx, orderId);
      await transitionOrder(tx, locked, "APPROVED", "PHARMACIST", actor, { note: outcome === "PARTIALLY_APPROVED" ? "Approved with some items rejected" : "Prescription approved", data: { firstDecisionAt, approvedAt: now } });
      await createRefillPlans(tx, orderId);
      await notify(tx, locked.customerId, "ORDER_APPROVED", { orderNumber: locked.orderNumber });
    }
  });
}

async function recalculateSubtotal(tx: Tx, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId, status: { not: "REJECTED" } } });
  const subtotal = items.reduce((s, i) => s + i.unitPricePaise * (i.approvedQuantity ?? i.quantity), 0);
  await tx.order.update({ where: { id: orderId }, data: { subtotalPaise: subtotal } });
  await adjustTestPayment(tx, orderId, subtotal);
}

/**
 * Customer's answer to a pharmacist-proposed generic alternative. Accepting records consent and
 * applies the substitution; declining leaves the original product and returns the order to the
 * pharmacist. Nothing is substituted without both the pharmacist proposal and this consent.
 */
export async function respondToSubstitution(actor: Actor | null, proposalId: string, accept: boolean) {
  assertRole(actor, ["CUSTOMER"]);
  const proposal = await db.substitutionProposal.findUnique({ where: { id: proposalId }, include: { order: true, proposedBy: true, substituteProduct: true } });
  if (!proposal || proposal.order.customerId !== actor.id) throw new DomainError("NOT_FOUND", "Suggestion not found.");
  if (proposal.proposedBy.role !== "PHARMACIST") throw new DomainError("FORBIDDEN", "Only a pharmacist can propose a substitution.");

  await db.$transaction(async (tx) => {
    const order = await lockOrder(tx, proposal.orderId);
    const current = await tx.substitutionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    if (current.status !== "PENDING_CONSENT" || order.status !== "AWAITING_CUSTOMER_CONSENT") {
      throw new DomainError("CONFLICT", "This suggestion has already been answered.");
    }
    const consent = await tx.consent.create({
      data: {
        customerId: actor.id,
        type: "GENERIC_SUBSTITUTION",
        granted: accept,
        channel: "IN_APP",
        subjectType: "SubstitutionProposal",
        subjectId: proposalId,
        textVersion: GENERIC_CONSENT_TEXT_VERSION,
      },
    });
    await tx.substitutionProposal.update({
      where: { id: proposalId },
      data: { status: accept ? "ACCEPTED" : "DECLINED", consentId: consent.id, decidedAt: new Date() },
    });
    const item = await tx.orderItem.findUniqueOrThrow({ where: { id: proposal.orderItemId } });
    if (accept) {
      const qty = item.approvedQuantity ?? item.quantity;
      if (order.routingStatus === "ROUTED") await swapReservation(tx, item.id, proposal.substituteProductId, qty);
      await tx.orderItem.update({
        where: { id: item.id },
        data: { productId: proposal.substituteProductId, unitPricePaise: proposal.substituteProduct.pricePaise, status: "APPROVED" },
      });
    } else {
      // Declined: the pharmacist must decide again on the original product.
      await tx.orderItem.update({ where: { id: item.id }, data: { status: "PENDING_REVIEW", approvedByReviewId: null, approvedQuantity: null } });
    }
    await audit(tx, { actor, action: "SUBSTITUTION_CONSENT_RECORDED", entityType: "SubstitutionProposal", entityId: proposalId, metadata: { granted: accept } });

    const stillPending = await tx.substitutionProposal.count({ where: { orderId: order.id, status: "PENDING_CONSENT" } });
    if (stillPending > 0) return;
    await recalculateSubtotal(tx, order.id);
    const needsPharmacist = await tx.orderItem.count({ where: { orderId: order.id, status: "PENDING_REVIEW" } });
    if (needsPharmacist > 0) {
      await transitionOrder(tx, order, "AWAITING_PHARMACIST", "CUSTOMER", actor, { note: "Customer declined the generic alternative" });
    } else {
      await assertApprovalGate(tx, order.id);
      await transitionOrder(tx, order, "APPROVED", "CUSTOMER", actor, { note: "Customer consented to the pharmacist's generic alternative", data: { approvedAt: new Date() } });
      await createRefillPlans(tx, order.id);
    }
  });
}

export async function recordReviewOpened(actor: Actor | null, orderId: string) {
  assertRole(actor, ["PHARMACIST"]);
  await audit(db, { actor, action: "PRESCRIPTION_REVIEW_OPENED", entityType: "Order", entityId: orderId });
}
