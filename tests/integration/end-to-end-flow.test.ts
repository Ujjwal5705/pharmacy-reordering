import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { addToCart } from "@/server/services/cart";
import { advanceFulfilment, submitOrder } from "@/server/services/orders";
import { readPrescriptionFile, uploadPrescription } from "@/server/services/prescriptions";
import { addRefillToCart, dispatchDueReminders, setRefillOptIn } from "@/server/services/refills";
import { submitReview } from "@/server/services/review";
import { buildWorld, inventory, pngFile, type World } from "../support/world";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(() => db.$disconnect());

describe("customer submission → pharmacist review → store routing → fulfilment → refill", () => {
  let orderId = "";
  let prescriptionId = "";

  it("customer uploads a prescription and receives an AI draft (not a decision)", async () => {
    const res = await uploadPrescription(w.actors.customerA, { familyMemberId: w.members.a.id, file: pngFile("rx-sunita-ghosh.png") });
    prescriptionId = res.prescriptionId;
    expect(res.status).toBe("SUCCEEDED");
    const run = await db.extractionRun.findFirstOrThrow({ where: { prescriptionId }, include: { lines: true, fields: true } });
    const met = run.lines.find((l) => l.medicineName === "Metformin")!;
    expect(met.matchedProductId).toBe(w.products.metformin.id);
    expect(Number(met.unitsPerDay)).toBe(2);
    expect(met.quantityUnits).toBe(60);
    expect(met.quantityDerived).toBe(true);
    const lev = run.lines.find((l) => l.medicineName === "Levothyroxine")!;
    expect(lev.dosageText).toBeNull(); // "as directed" is not turned into a dose
    expect(await db.auditEvent.count({ where: { action: "PRESCRIPTION_UPLOADED", entityId: prescriptionId } })).toBe(1);
  });

  it("submits the cart into the pharmacist queue and routes to the nearest store with full stock", async () => {
    await addToCart(w.actors.customerA, w.members.a.id, w.products.metformin.id, 4);
    const res = await submitOrder(w.actors.customerA, {
      familyMemberId: w.members.a.id,
      localityId: w.localities.saltLake.id,
      deliveryAddress: "1 Test Road, Salt Lake",
      paymentMethod: "UPI_TEST",
      prescriptionId,
      source: "CATALOGUE",
    });
    orderId = res.orderId;
    expect(res.routed).toBe(true);
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, reviews: true, payment: true } });
    expect(order.status).toBe("AWAITING_PHARMACIST");
    // NEAR has only 2 strips of metformin, so the order goes to MID (next nearest with 4).
    expect(order.storeId).toBe(w.stores.mid.id);
    expect(order.items[0].status).toBe("PENDING_REVIEW");
    expect(order.reviews).toHaveLength(0); // extraction approved nothing
    expect(order.payment?.status).toBe("TEST_PAID");
    expect((await inventory(w.stores.mid.id, w.products.metformin.id)).reserved).toBe(4);
    expect(await db.cartItem.count({ where: { customerId: w.actors.customerA.id } })).toBe(0);
  });

  it("store cannot pick before the pharmacist approves", async () => {
    await expect(advanceFulfilment(w.actors.staffMid, orderId, { step: "START_PICKING" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("pharmacist views the prescription (audited) and approves with confirmed dosage", async () => {
    const file = await readPrescriptionFile(w.actors.pharmacist, prescriptionId);
    expect(file.mimeType).toBe("image/png");
    expect(file.bytes.subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(await db.auditEvent.count({ where: { action: "PRESCRIPTION_FILE_VIEWED", entityId: prescriptionId, actorId: w.actors.pharmacist.id } })).toBe(1);

    const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
    await submitReview(w.actors.pharmacist, orderId, {
      outcome: "DECIDE",
      header: { patientName: "Sunita Ghosh", prescriberName: "Dr. Arindam Banerjee", prescriberRegNo: "WBMC-DEMO-1042", prescriptionDate: "2026-10-03" },
      items: [{ orderItemId: item.id, decision: "APPROVE", approvedQuantity: 4, unitsPerDay: 2, dosageInstruction: "1-0-1 (twice daily)" }],
    });
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, refillPlans: true } });
    expect(order.status).toBe("APPROVED");
    expect(order.firstDecisionAt).not.toBeNull();
    expect(order.items[0].approvedByReviewId).not.toBeNull();
    expect(order.refillPlans).toHaveLength(1);
    expect(order.refillPlans[0]).toMatchObject({ status: "AWAITING_DELIVERY", optedIn: false, unitsSupplied: 60 });
  });

  it("store picks, packs with invoice, hands over and delivers; stock is consumed", async () => {
    await expect(advanceFulfilment(w.actors.staffNear, orderId, { step: "START_PICKING" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await advanceFulfilment(w.actors.staffMid, orderId, { step: "START_PICKING" });
    await expect(advanceFulfilment(w.actors.staffMid, orderId, { step: "MARK_PACKED", storeInvoiceNumber: "!" })).rejects.toThrow();
    await advanceFulfilment(w.actors.staffMid, orderId, { step: "MARK_PACKED", storeInvoiceNumber: "MID-INV-0001" });
    const inv = await inventory(w.stores.mid.id, w.products.metformin.id);
    expect([inv.onHand, inv.reserved]).toEqual([16, 0]);
    await advanceFulfilment(w.actors.staffMid, orderId, { step: "HAND_OVER", deliveryPartner: "Store rider (test)" });
    await advanceFulfilment(w.actors.staffMid, orderId, { step: "MARK_DELIVERED" });

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { events: { orderBy: { createdAt: "asc" } }, refillPlans: true } });
    expect(order.status).toBe("DELIVERED");
    expect(order.storeInvoiceNumber).toBe("MID-INV-0001");
    expect(order.events.map((e) => e.toStatus)).toEqual(["AWAITING_PHARMACIST", "APPROVED", "PICKING", "PACKED", "HANDED_TO_DELIVERY", "DELIVERED"]);
    const plan = order.refillPlans[0];
    expect(plan.status).toBe("ACTIVE");
    const days = Math.round((plan.runOutDate!.getTime() - order.deliveredAt!.getTime()) / 86_400_000);
    expect(days).toBe(30);
  });

  it("refill reminders require opt-in, send a mock notification and never create an order", async () => {
    const plan = await db.refillPlan.findFirstOrThrow({ where: { sourceOrderId: orderId } });
    const future = new Date(plan.remindAt!.getTime() + 1000);
    const ordersBefore = await db.order.count();

    expect((await dispatchDueReminders(future)).sent).toBe(0); // not opted in
    await expect(setRefillOptIn(w.actors.customerB, plan.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await setRefillOptIn(w.actors.customerA, plan.id, true, "SMS");
    expect(await db.consent.count({ where: { type: "REFILL_REMINDERS", subjectId: plan.id, granted: true } })).toBe(1);

    expect((await dispatchDueReminders(new Date(plan.remindAt!.getTime() - 60_000))).sent).toBe(0); // not due yet
    expect((await dispatchDueReminders(future)).sent).toBe(1);
    expect((await dispatchDueReminders(future)).sent).toBe(0); // not repeated
    const log = await db.notificationLog.findFirstOrThrow({ where: { template: "REFILL_DUE" } });
    expect(log).toMatchObject({ channel: "SMS", status: "MOCK_SENT" });
    expect(JSON.stringify(log.metadata)).not.toMatch(/metformin/i);

    expect(await db.order.count()).toBe(ordersBefore);
    expect(await db.cartItem.count()).toBe(0);

    // One-tap reorder only pre-fills the cart; nothing is submitted.
    await addRefillToCart(w.actors.customerA, plan.id);
    expect(await db.cartItem.findFirstOrThrow({ where: { customerId: w.actors.customerA.id } })).toMatchObject({ quantity: 4, productId: w.products.metformin.id });
    expect(await db.order.count()).toBe(ordersBefore);
  });
});
