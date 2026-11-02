import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setExtractionProviderOverride } from "@/server/extraction/registry";
import { addToCart } from "@/server/services/cart";
import { routeOrder } from "@/server/services/inventory";
import { advanceFulfilment, cancelOrder, reuploadPrescription, submitOrder } from "@/server/services/orders";
import { createPolicyVersion } from "@/server/services/policies";
import { readPrescriptionFile, uploadPrescription } from "@/server/services/prescriptions";
import { respondToSubstitution, submitReview } from "@/server/services/review";
import { buildWorld, inventory, pngFile, type World } from "../support/world";

let w: World;
beforeEach(async () => {
  setExtractionProviderOverride(null);
  w = await buildWorld();
});
afterAll(() => db.$disconnect());

async function placeOrder(productId: string, qty = 1, file = "rx-sunita-ghosh.png", actor = () => w.actors.customerA, memberId = () => w.members.a.id) {
  const rx = await uploadPrescription(actor(), { familyMemberId: memberId(), file: pngFile(file) });
  await addToCart(actor(), memberId(), productId, qty);
  const res = await submitOrder(actor(), {
    familyMemberId: memberId(),
    localityId: w.localities.saltLake.id,
    deliveryAddress: "1 Test Road",
    paymentMethod: "COD_TEST",
    prescriptionId: rx.prescriptionId,
    source: "CATALOGUE",
  });
  return { ...res, prescriptionId: rx.prescriptionId };
}
const header = { prescriberName: "Dr. Test", prescriptionDate: "2026-10-01" };
const itemOf = (orderId: string) => db.orderItem.findFirstOrThrow({ where: { orderId } });

describe("1. Schedule X and narcotic items are blocked online", () => {
  it.each(["scheduleX", "narcotic"] as const)("cannot add %s to the cart", async (key) => {
    await expect(addToCart(w.actors.customerA, w.members.a.id, w.products[key].id)).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
  });

  it("checkout rejects a cart that contains a blocked item even if inserted directly", async () => {
    await db.cartItem.create({ data: { customerId: w.actors.customerA.id, familyMemberId: w.members.a.id, productId: w.products.scheduleX.id, quantity: 1 } });
    await expect(
      submitOrder(w.actors.customerA, { familyMemberId: w.members.a.id, localityId: w.localities.saltLake.id, deliveryAddress: "1 Test Road", paymentMethod: "UPI_TEST", prescriptionId: null, source: "CATALOGUE" }),
    ).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    expect(await db.order.count()).toBe(0);
  });

  it("routing and dispatch refuse an order whose item category is now not sold online", async () => {
    const { orderId } = await placeOrder(w.products.metformin.id, 1);
    // Simulate a forged order line for a narcotic product.
    const item = await itemOf(orderId);
    await db.orderItem.update({ where: { id: item.id }, data: { productId: w.products.narcotic.id, requestedProductId: w.products.narcotic.id } });
    await db.order.update({ where: { id: orderId }, data: { routingStatus: "NOT_ROUTED", storeId: null } });
    await expect(routeOrder(orderId, null)).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
  });

  it("policies cannot be configured to sell Schedule X online (service and database)", async () => {
    await expect(
      createPolicyVersion(w.actors.ops, { category: "SCHEDULE_X", effectiveFrom: new Date(), effectiveTo: null, onlineOrderable: true, prescriptionRequired: true, pharmacistApprovalRequired: true, h1RegisterRequired: false, description: "attempt to allow" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      db.medicinePolicy.create({ data: { category: "NARCOTIC", version: 99, effectiveFrom: new Date(), onlineOrderable: true, prescriptionRequired: true, pharmacistApprovalRequired: true, h1RegisterRequired: false, description: "direct SQL bypass" } }),
    ).rejects.toThrow(/statutory_floor/);
  });

  it("a stricter new policy version blocks dispatch of an already-approved order", async () => {
    const { orderId } = await placeOrder(w.products.metformin.id, 1);
    await submitReview(w.actors.pharmacist, orderId, { outcome: "DECIDE", header, items: [{ orderItemId: (await itemOf(orderId)).id, decision: "APPROVE" }] });
    await createPolicyVersion(w.actors.ops, { category: "SCHEDULE_H", effectiveFrom: new Date(Date.now() - 1000), effectiveTo: null, onlineOrderable: false, prescriptionRequired: true, pharmacistApprovalRequired: true, h1RegisterRequired: false, description: "Hypothetical suspension of online H sales" });
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const staff = order.storeId === w.stores.near.id ? w.actors.staffNear : w.actors.staffMid;
    await expect(advanceFulfilment(staff, orderId, { step: "START_PICKING" })).rejects.toMatchObject({ code: "DISPATCH_BLOCKED" });
    expect(await db.auditEvent.count({ where: { action: "POLICY_VERSION_CREATED" } })).toBe(1);
  });
});

describe("2. Schedule H/H1 cannot be dispatched before pharmacist approval", () => {
  it("blocks dispatch of an order forced to APPROVED without a pharmacist review", async () => {
    const { orderId } = await placeOrder(w.products.telmisartan.id, 1);
    await db.order.update({ where: { id: orderId }, data: { status: "APPROVED" } });
    await db.orderItem.updateMany({ where: { orderId }, data: { status: "APPROVED" } });
    const err = await advanceFulfilment(w.actors.staffNear, orderId, { step: "START_PICKING" }).catch((e) => e);
    expect(err.code).toBe("DISPATCH_BLOCKED");
    expect(err.details.join()).toMatch(/not been approved by a pharmacist/);
  });

  it("does not count an approval recorded by an unregistered account", async () => {
    const { orderId } = await placeOrder(w.products.telmisartan.id, 1);
    const review = await db.pharmacistReview.create({ data: { orderId, reviewerId: w.actors.unregistered.id, reviewerRegNo: "", outcome: "APPROVED" } });
    await db.order.update({ where: { id: orderId }, data: { status: "APPROVED" } });
    await db.orderItem.updateMany({ where: { orderId }, data: { status: "APPROVED", approvedByReviewId: review.id } });
    await expect(advanceFulfilment(w.actors.staffNear, orderId, { step: "START_PICKING" })).rejects.toMatchObject({ code: "DISPATCH_BLOCKED" });
  });

  it("an approval needs the prescriber and prescription date confirmed", async () => {
    const { orderId } = await placeOrder(w.products.telmisartan.id, 1);
    const err = await submitReview(w.actors.pharmacist, orderId, { outcome: "DECIDE", header: {}, items: [{ orderItemId: (await itemOf(orderId)).id, decision: "APPROVE" }] }).catch((e) => e);
    expect(err.code).toBe("VALIDATION");
    expect(err.details.join()).toMatch(/prescriber/);
  });
});

describe("3. H1 register details are captured before dispatch", () => {
  const h1 = { patientName: "Parent of A", patientAddress: "1 Test Road, Salt Lake", prescriberName: "Dr. Test", prescriberAddress: "Clinic Road, Kolkata" };

  it("rejects approval of an H1 item without register details", async () => {
    const { orderId } = await placeOrder(w.products.h1.id, 1, "rx-priya-das-h1.png");
    const err = await submitReview(w.actors.pharmacist, orderId, { outcome: "DECIDE", header, items: [{ orderItemId: (await itemOf(orderId)).id, decision: "APPROVE" }] }).catch((e) => e);
    expect(err.code).toBe("VALIDATION");
    expect(err.details.join()).toMatch(/H1 register/);
  });

  it("records the register entry and then allows dispatch; removing it blocks dispatch again", async () => {
    const { orderId } = await placeOrder(w.products.h1.id, 2, "rx-priya-das-h1.png");
    const item = await itemOf(orderId);
    await submitReview(w.actors.pharmacist, orderId, { outcome: "DECIDE", header, items: [{ orderItemId: item.id, decision: "APPROVE", h1 }] });
    const entry = await db.h1RegisterEntry.findUniqueOrThrow({ where: { orderItemId: item.id } });
    expect(entry).toMatchObject({ patientName: h1.patientName, prescriberName: h1.prescriberName, quantitySupplied: 2, recordedById: w.actors.pharmacist.id });
    // A short-course product not marked for refill reminders gets no reminder plan.
    expect(await db.refillPlan.count({ where: { sourceOrderId: orderId } })).toBe(0);

    await db.h1RegisterEntry.delete({ where: { id: entry.id } });
    await expect(advanceFulfilment(w.actors.staffNear, orderId, { step: "START_PICKING" })).rejects.toMatchObject({ code: "DISPATCH_BLOCKED" });
  });
});

describe("4 & 5. AI never approves; unreadable prescriptions cannot silently proceed", () => {
  it("a high-confidence extraction leaves every item pending for the pharmacist", async () => {
    const { orderId } = await placeOrder(w.products.metformin.id, 1);
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, reviews: true } });
    expect(order.status).toBe("AWAITING_PHARMACIST");
    expect(order.items.every((i) => i.status === "PENDING_REVIEW" && i.approvedByReviewId === null && i.unitsPerDay === null)).toBe(true);
    expect(order.reviews).toHaveLength(0);
    expect(order.manualReviewRequired).toBe(false);
  });

  it("a blurred prescription is flagged LOW_CONFIDENCE and the order is marked for manual review", async () => {
    const rx = await uploadPrescription(w.actors.customerA, { familyMemberId: w.members.a.id, file: pngFile("rx-arif-mondal-blurred.png") });
    expect(rx.status).toBe("LOW_CONFIDENCE");
    expect(rx.issues.join()).toMatch(/re-upload/i);
    await addToCart(w.actors.customerA, w.members.a.id, w.products.levothyroxine.id, 1);
    const { orderId } = await submitOrder(w.actors.customerA, { familyMemberId: w.members.a.id, localityId: w.localities.saltLake.id, deliveryAddress: "1 Test Road", paymentMethod: "UPI_TEST", prescriptionId: rx.prescriptionId, source: "CATALOGUE" });
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ status: "AWAITING_PHARMACIST", manualReviewRequired: true });
  });

  it("a failing provider keeps the prescription and routes it to manual review", async () => {
    setExtractionProviderOverride({ name: "broken", external: false, supports: () => true, extract: async () => { throw new Error("provider down"); } });
    const rx = await uploadPrescription(w.actors.customerA, { familyMemberId: w.members.a.id, file: pngFile("rx-sunita-ghosh.png") });
    expect(rx.status).toBe("FAILED");
    expect(await db.prescription.count({ where: { id: rx.prescriptionId } })).toBe(1);
    const run = await db.extractionRun.findFirstOrThrow({ where: { prescriptionId: rx.prescriptionId } });
    expect(run).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_ERROR" });
  });

  it("pharmacist re-upload request → customer re-upload returns the order to the queue", async () => {
    const { orderId, prescriptionId } = await placeOrder(w.products.levothyroxine.id, 1, "rx-arif-mondal-blurred.png");
    await expect(submitReview(w.actors.pharmacist, orderId, { outcome: "REQUEST_REUPLOAD", reason: "no" })).rejects.toThrow();
    await submitReview(w.actors.pharmacist, orderId, { outcome: "REQUEST_REUPLOAD", reason: "Strength not legible; please upload a clear photo." });
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("NEEDS_REUPLOAD");

    await expect(reuploadPrescription(w.actors.customerA, orderId, prescriptionId)).rejects.toMatchObject({ code: "VALIDATION" });
    const fresh = await uploadPrescription(w.actors.customerA, { familyMemberId: w.members.a.id, file: pngFile("rx-sunita-ghosh.png") });
    await reuploadPrescription(w.actors.customerA, orderId, fresh.prescriptionId);
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ status: "AWAITING_PHARMACIST", prescriptionId: fresh.prescriptionId, manualReviewRequired: false });
    expect((await db.prescription.findUniqueOrThrow({ where: { id: prescriptionId } })).status).toBe("SUPERSEDED");
  });
});

describe("6. Generic substitution needs pharmacist approval and customer consent", () => {
  async function proposeGeneric() {
    // Customer asked for the brand; pharmacist proposes the equivalent generic.
    const { orderId } = await placeOrder(w.products.metforminBrand.id, 2);
    const item = await itemOf(orderId);
    await submitReview(w.actors.pharmacist, orderId, {
      outcome: "DECIDE",
      header,
      items: [{ orderItemId: item.id, decision: "PROPOSE_SUBSTITUTE", substituteProductId: w.products.metformin.id, unitsPerDay: 2 }],
    });
    const proposal = await db.substitutionProposal.findFirstOrThrow({ where: { orderId } });
    return { orderId, itemId: item.id, proposal };
  }

  it("proposal alone changes nothing and blocks dispatch", async () => {
    const { orderId, itemId } = await proposeGeneric();
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("AWAITING_CUSTOMER_CONSENT");
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: itemId } })).productId).toBe(w.products.metforminBrand.id);
    const staff = order.storeId === w.stores.mid.id ? w.actors.staffMid : w.actors.staffNear;
    await expect(advanceFulfilment(staff, orderId, { step: "START_PICKING" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("only the pharmacist can propose; only the owning customer can consent", async () => {
    const { proposal } = await proposeGeneric();
    await expect(respondToSubstitution(w.actors.customerB, proposal.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(respondToSubstitution(w.actors.pharmacist, proposal.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a brand as the 'generic' alternative", async () => {
    const { orderId } = await placeOrder(w.products.metformin.id, 1);
    const err = await submitReview(w.actors.pharmacist, orderId, { outcome: "DECIDE", header, items: [{ orderItemId: (await itemOf(orderId)).id, decision: "PROPOSE_SUBSTITUTE", substituteProductId: w.products.metforminBrand.id }] }).catch((e) => e);
    expect(err.code).toBe("VALIDATION");
    expect(err.details.join()).toMatch(/generic/);
  });

  it("rejects a non-equivalent alternative", async () => {
    const { orderId } = await placeOrder(w.products.metforminBrand.id, 1);
    const err = await submitReview(w.actors.pharmacist, orderId, { outcome: "DECIDE", header, items: [{ orderItemId: (await itemOf(orderId)).id, decision: "PROPOSE_SUBSTITUTE", substituteProductId: w.products.telmisartan.id }] }).catch((e) => e);
    expect(err.code).toBe("VALIDATION");
  });

  it("accepting records consent, swaps product and stock, and approves", async () => {
    const { orderId, itemId, proposal } = await proposeGeneric();
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    await respondToSubstitution(w.actors.customerA, proposal.id, true);
    const after = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    expect(after.status).toBe("APPROVED");
    expect(after.items[0]).toMatchObject({ productId: w.products.metformin.id, requestedProductId: w.products.metforminBrand.id, unitPricePaise: 12000 });
    expect(after.subtotalPaise).toBe(24000);
    expect(await db.consent.count({ where: { type: "GENERIC_SUBSTITUTION", subjectId: proposal.id, granted: true, customerId: w.actors.customerA.id } })).toBe(1);
    expect((await inventory(order.storeId!, w.products.metformin.id)).reserved).toBe(2);
    expect((await inventory(order.storeId!, w.products.metforminBrand.id)).reserved).toBe(0);
    await expect(respondToSubstitution(w.actors.customerA, proposal.id, false)).rejects.toMatchObject({ code: "CONFLICT" });

    // Dispatch passes once consent exists; forging away the consent blocks it.
    const staff = order.storeId === w.stores.mid.id ? w.actors.staffMid : w.actors.staffNear;
    await db.substitutionProposal.update({ where: { id: proposal.id }, data: { status: "DECLINED" } });
    await expect(advanceFulfilment(staff, orderId, { step: "START_PICKING" })).rejects.toMatchObject({ code: "DISPATCH_BLOCKED" });
    await db.substitutionProposal.update({ where: { id: proposal.id }, data: { status: "ACCEPTED" } });
    await advanceFulfilment(staff, orderId, { step: "START_PICKING" });
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe("APPROVED");
  });

  it("declining keeps the original product and returns the order to the pharmacist", async () => {
    const { orderId, itemId, proposal } = await proposeGeneric();
    await respondToSubstitution(w.actors.customerA, proposal.id, false);
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("AWAITING_PHARMACIST");
    expect(await db.orderItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({ productId: w.products.metforminBrand.id, status: "PENDING_REVIEW", approvedByReviewId: null });
    expect(await db.consent.count({ where: { subjectId: proposal.id, granted: false } })).toBe(1);
  });
});

describe("7 & 8. Role and ownership checks on the server", () => {
  it("only a registered pharmacist in scope can decide", async () => {
    const { orderId } = await placeOrder(w.products.telmisartan.id, 1);
    const input = { outcome: "REJECT_ORDER" as const, reason: "Testing access control" };
    await expect(submitReview(w.actors.customerA, orderId, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(submitReview(w.actors.staffNear, orderId, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(submitReview(w.actors.ops, orderId, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(submitReview(w.actors.unregistered, orderId, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(submitReview(w.actors.farPharmacist, orderId, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(submitReview(null, orderId, input)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("customers only see and act on their own records", async () => {
    const { orderId, prescriptionId } = await placeOrder(w.products.telmisartan.id, 1);
    await expect(readPrescriptionFile(w.actors.customerB, prescriptionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.auditEvent.count({ where: { action: "ACCESS_DENIED", entityId: prescriptionId, actorId: w.actors.customerB.id } })).toBe(1);
    await expect(cancelOrder(w.actors.customerB, orderId, "not mine")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addToCart(w.actors.customerB, w.members.a.id, w.products.otc.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(uploadPrescription(w.actors.customerB, { familyMemberId: w.members.a.id, file: pngFile("rx-rina-sen.png") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readPrescriptionFile(w.actors.customerA, prescriptionId)).resolves.toBeTruthy();
  });

  it("store staff and operations cannot open prescription images; out-of-scope pharmacists cannot either", async () => {
    const { prescriptionId } = await placeOrder(w.products.telmisartan.id, 1);
    for (const a of [w.actors.staffNear, w.actors.ops, w.actors.farPharmacist]) {
      await expect(readPrescriptionFile(a, prescriptionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("customers cannot drive store fulfilment", async () => {
    const { orderId } = await placeOrder(w.products.telmisartan.id, 1);
    await expect(advanceFulfilment(w.actors.customerA, orderId, { step: "START_PICKING" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("cancellation and audit", () => {
  it("cancelling releases reserved stock and voids the test payment", async () => {
    const { orderId } = await placeOrder(w.products.telmisartan.id, 3);
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect((await inventory(order.storeId!, w.products.telmisartan.id)).reserved).toBe(3);
    await cancelOrder(w.actors.customerA, orderId, "Ordered by mistake");
    expect((await inventory(order.storeId!, w.products.telmisartan.id)).reserved).toBe(0);
    expect((await db.paymentRecord.findUniqueOrThrow({ where: { orderId } })).status).toBe("VOID");
  });

  it("the audit trail is append-only at the database level", async () => {
    const { prescriptionId } = await placeOrder(w.products.telmisartan.id, 1);
    const ev = await db.auditEvent.findFirstOrThrow({ where: { entityId: prescriptionId } });
    await expect(db.auditEvent.update({ where: { id: ev.id }, data: { action: "TAMPERED" } })).rejects.toThrow(/append-only/);
    await expect(db.auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
  });
});
