"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/server/actor";
import { getActor } from "@/server/auth/session";
import { DomainError, runAction } from "@/server/errors";
import { advanceFulfilment, retryRouting, type FulfilmentInput } from "@/server/services/orders";
import { createPolicyVersion } from "@/server/services/policies";
import { dispatchDueReminders } from "@/server/services/refills";
import { submitReview, type ReviewInput } from "@/server/services/review";
import { applyStockImport, discardStockImport, previewStockImport, MAX_STOCK_CSV_BYTES } from "@/server/services/stock-import";

export async function submitReviewAction(orderId: string, input: ReviewInput) {
  return runAction("pharmacist.review", async () => {
    await submitReview(await getActor(), orderId, input);
    revalidatePath("/pharmacist");
    revalidatePath(`/pharmacist/orders/${orderId}`);
  }, "Decision recorded");
}

export async function fulfilmentAction(orderId: string, input: FulfilmentInput) {
  return runAction("store.fulfilment", async () => {
    await advanceFulfilment(await getActor(), orderId, input);
    revalidatePath("/store");
  }, "Order updated");
}

export async function retryRoutingAction(orderId: string) {
  return runAction("ops.retryRouting", async () => {
    const r = await retryRouting(await getActor(), orderId);
    revalidatePath("/ops");
    if (!r.routed) throw new DomainError("NO_STOCK", "Still no single store has every item in stock. Import fresh stock or contact the customer.");
  }, "Order routed to a store with stock");
}

export async function previewStockAction(formData: FormData) {
  return runAction("ops.stockPreview", async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("VALIDATION", "Choose a CSV file.");
    if (file.size > MAX_STOCK_CSV_BYTES) throw new DomainError("VALIDATION", "CSV is larger than 2 MB.");
    if (!/\.csv$/i.test(file.name)) throw new DomainError("VALIDATION", "The file must be a .csv.");
    const r = await previewStockImport(await getActor(), file.name, await file.text());
    revalidatePath("/ops/stock");
    return r;
  });
}

export async function applyStockAction(batchId: string) {
  return runAction("ops.stockApply", async () => {
    const r = await applyStockImport(await getActor(), batchId);
    revalidatePath("/ops", "layout");
    return r;
  });
}

export async function discardStockAction(batchId: string) {
  return runAction("ops.stockDiscard", async () => {
    await discardStockImport(await getActor(), batchId);
    revalidatePath("/ops/stock");
  }, "Import discarded");
}

export async function createPolicyAction(input: {
  category: string;
  effectiveFrom: string;
  effectiveTo: string;
  onlineOrderable: boolean;
  prescriptionRequired: boolean;
  pharmacistApprovalRequired: boolean;
  h1RegisterRequired: boolean;
  description: string;
}) {
  return runAction("ops.policy", async () => {
    await createPolicyVersion(await getActor(), {
      ...input,
      category: input.category as "OTC",
      effectiveTo: input.effectiveTo ? input.effectiveTo : null,
    });
    revalidatePath("/ops/policies");
  }, "New policy version saved");
}

export async function runRemindersAction() {
  return runAction("ops.reminders", async () => {
    assertRole(await getActor(), ["OPS_ADMIN"]);
    return dispatchDueReminders();
  });
}
