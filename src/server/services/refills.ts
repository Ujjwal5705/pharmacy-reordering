import type { Channel } from "@prisma/client";
import { assertRole, type Actor } from "../actor";
import { audit } from "../audit";
import { db, type Tx } from "../db";
import { estimateRefill } from "../domain/refill";
import { evaluateCategory } from "../domain/policy";
import { config } from "../env";
import { DomainError } from "../errors";
import { loadPolicyRules } from "./catalogue";
import { notify } from "./notifications";

export const REFILL_CONSENT_TEXT_VERSION = "refill-reminder-v1";

/** One plan per pharmacist-approved item. Dates are only calculated later, from delivery. */
export async function createRefillPlans(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { where: { status: "APPROVED", approvedByReviewId: { not: null } }, include: { product: true, refillPlan: true } } },
  });
  for (const item of order.items) {
    if (item.refillPlan) continue;
    const packs = item.approvedQuantity ?? item.quantity;
    const upd = item.unitsPerDay === null ? null : Number(item.unitsPerDay);
    const est = estimateRefill({ packs, unitsPerPack: item.product.unitsPerPack, unitsPerDay: upd, startDate: null, remindDaysBefore: 0 });
    await tx.refillPlan.create({
      data: {
        customerId: order.customerId,
        familyMemberId: order.familyMemberId,
        productId: item.productId,
        sourceOrderId: order.id,
        sourceOrderItemId: item.id,
        packsSupplied: packs,
        unitsSupplied: est.unitsSupplied,
        unitsPerDay: est.kind === "NEEDS_DOSAGE" ? null : upd,
        status: est.kind === "NEEDS_DOSAGE" ? "NEEDS_DOSAGE" : "AWAITING_DELIVERY",
      },
    });
  }
}

/** On delivery: run-out date = delivery date + units ÷ units-per-day (pharmacist-confirmed only). */
export async function startRefillPlans(tx: Tx, orderId: string, deliveredAt: Date) {
  const plans = await tx.refillPlan.findMany({ where: { sourceOrderId: orderId } });
  const remindDaysBefore = config().REFILL_REMIND_DAYS_BEFORE;
  for (const p of plans) {
    const product = await tx.product.findUniqueOrThrow({ where: { id: p.productId } });
    const est = estimateRefill({
      packs: p.packsSupplied,
      unitsPerPack: product.unitsPerPack,
      unitsPerDay: p.unitsPerDay === null ? null : Number(p.unitsPerDay),
      startDate: deliveredAt,
      remindDaysBefore,
    });
    if (est.kind !== "ESTIMATED") {
      await tx.refillPlan.update({ where: { id: p.id }, data: { startDate: deliveredAt, status: "NEEDS_DOSAGE" } });
      continue;
    }
    await tx.refillPlan.update({
      where: { id: p.id },
      data: { startDate: deliveredAt, runOutDate: est.runOutDate, remindAt: est.remindAt, status: "ACTIVE" },
    });
  }
}

export async function setRefillOptIn(actor: Actor | null, planId: string, optedIn: boolean, channel: Channel = "IN_APP") {
  assertRole(actor, ["CUSTOMER"]);
  const plan = await db.refillPlan.findFirst({ where: { id: planId, customerId: actor.id } });
  if (!plan) throw new DomainError("NOT_FOUND", "Reminder not found.");
  await db.$transaction(async (tx) => {
    await tx.consent.create({
      data: {
        customerId: actor.id,
        type: "REFILL_REMINDERS",
        granted: optedIn,
        channel,
        subjectType: "RefillPlan",
        subjectId: plan.id,
        textVersion: REFILL_CONSENT_TEXT_VERSION,
      },
    });
    await tx.refillPlan.update({ where: { id: plan.id }, data: { optedIn, channel } });
    await audit(tx, { actor, action: "REFILL_OPT_IN_CHANGED", entityType: "RefillPlan", entityId: plan.id, metadata: { optedIn, channel } });
  });
}

/**
 * Sends due reminders through the (mock) notification adapters. Reminders are suggestions only:
 * this never creates a cart item or an order.
 */
export async function dispatchDueReminders(now: Date = new Date()) {
  const due = await db.refillPlan.findMany({
    where: { optedIn: true, status: "ACTIVE", remindAt: { lte: now } },
    include: { product: true },
  });
  let sent = 0;
  for (const p of due) {
    if (p.lastReminderSentAt && p.remindAt && p.lastReminderSentAt >= p.remindAt) continue;
    await db.$transaction(async (tx) => {
      await notify(tx, p.customerId, "REFILL_DUE", { planId: p.id }, p.channel);
      await tx.refillPlan.update({ where: { id: p.id }, data: { lastReminderSentAt: now } });
    });
    sent++;
  }
  return { checked: due.length, sent };
}

/** One-tap reorder from a reminder: pre-fills the cart. The customer still reviews and submits. */
export async function addRefillToCart(actor: Actor | null, planId: string) {
  assertRole(actor, ["CUSTOMER"]);
  const plan = await db.refillPlan.findFirst({ where: { id: planId, customerId: actor.id }, include: { product: true } });
  if (!plan) throw new DomainError("NOT_FOUND", "Reminder not found.");
  const rules = await loadPolicyRules(db);
  if (!plan.product.active || !evaluateCategory(rules, plan.product.category).orderable) {
    throw new DomainError("POLICY_BLOCKED", `${plan.product.name} is not available to order online.`);
  }
  const quantity = Math.min(20, Math.max(1, plan.packsSupplied));
  await db.cartItem.upsert({
    where: { familyMemberId_productId: { familyMemberId: plan.familyMemberId, productId: plan.productId } },
    create: { customerId: actor.id, familyMemberId: plan.familyMemberId, productId: plan.productId, quantity },
    update: { quantity },
  });
  return { familyMemberId: plan.familyMemberId };
}

/** One-tap reorder of a previous order's supplied items into the cart for the same patient. */
export async function reorderToCart(actor: Actor | null, orderId: string) {
  assertRole(actor, ["CUSTOMER"]);
  const order = await db.order.findFirst({
    where: { id: orderId, customerId: actor.id },
    include: { items: { include: { product: true } } },
  });
  if (!order) throw new DomainError("NOT_FOUND", "Order not found.");
  const rules = await loadPolicyRules(db);
  const skipped: string[] = [];
  let added = 0;
  for (const item of order.items.filter((i) => i.status !== "REJECTED")) {
    if (!item.product.active || !evaluateCategory(rules, item.product.category).orderable) {
      skipped.push(item.product.name);
      continue;
    }
    const quantity = Math.min(20, item.approvedQuantity ?? item.quantity);
    await db.cartItem.upsert({
      where: { familyMemberId_productId: { familyMemberId: order.familyMemberId, productId: item.productId } },
      create: { customerId: actor.id, familyMemberId: order.familyMemberId, productId: item.productId, quantity },
      update: { quantity },
    });
    added++;
  }
  return { familyMemberId: order.familyMemberId, added, skipped };
}
