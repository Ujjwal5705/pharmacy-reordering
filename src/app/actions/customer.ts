"use server";

import type { Channel } from "@prisma/client";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActor } from "@/server/auth/session";
import { PATIENT_COOKIE } from "@/server/customer-context";
import { db } from "@/server/db";
import { DomainError, runAction } from "@/server/errors";
import { addToCart, setCartQuantity } from "@/server/services/cart";
import { addFamilyMember, updateCustomerProfile } from "@/server/services/family";
import { cancelOrder, reuploadPrescription, submitOrder, type SubmitOrderInput } from "@/server/services/orders";
import { addRefillToCart, reorderToCart, setRefillOptIn } from "@/server/services/refills";
import { respondToSubstitution } from "@/server/services/review";

async function selectPatient(familyMemberId: string) {
  (await cookies()).set(PATIENT_COOKIE, familyMemberId, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 30 * 24 * 3600 });
}

export async function selectPatientAction(familyMemberId: string) {
  return runAction("customer.selectPatient", async () => {
    const actor = await getActor();
    const ok = actor && (await db.familyMember.findFirst({ where: { id: familyMemberId, customerId: actor.id } }));
    if (!ok) throw new DomainError("NOT_FOUND", "Patient profile not found.");
    await selectPatient(familyMemberId);
    revalidatePath("/", "layout");
  });
}

export async function addToCartAction(familyMemberId: string, productId: string) {
  return runAction("customer.addToCart", async () => {
    const r = await addToCart(await getActor(), familyMemberId, productId, 1);
    revalidatePath("/", "layout");
    return r;
  }, "Added to cart");
}

export async function setCartQuantityAction(familyMemberId: string, productId: string, quantity: number) {
  return runAction("customer.setQty", async () => {
    await setCartQuantity(await getActor(), familyMemberId, productId, quantity);
    revalidatePath("/", "layout");
  });
}

export async function submitOrderAction(input: SubmitOrderInput) {
  return runAction("customer.submitOrder", async () => {
    const r = await submitOrder(await getActor(), input);
    revalidatePath("/", "layout");
    return r;
  });
}

export async function cancelOrderAction(orderId: string, reason: string) {
  return runAction("customer.cancel", async () => {
    await cancelOrder(await getActor(), orderId, reason);
    revalidatePath(`/orders/${orderId}`);
  }, "Order cancelled");
}

export async function reuploadAction(orderId: string, prescriptionId: string) {
  return runAction("customer.reupload", async () => {
    await reuploadPrescription(await getActor(), orderId, prescriptionId);
    revalidatePath(`/orders/${orderId}`);
  }, "New prescription sent to the pharmacist");
}

export async function respondSubstitutionAction(proposalId: string, accept: boolean, orderId: string) {
  return runAction("customer.substitution", async () => {
    await respondToSubstitution(await getActor(), proposalId, accept);
    revalidatePath(`/orders/${orderId}`);
  }, accept ? "Thank you — your consent is recorded" : "We will keep the medicine you asked for");
}

export async function refillOptInAction(planId: string, optedIn: boolean, channel: Channel) {
  return runAction("customer.refillOptIn", async () => {
    await setRefillOptIn(await getActor(), planId, optedIn, z.enum(["IN_APP", "SMS", "WHATSAPP"]).parse(channel));
    revalidatePath("/", "layout");
  }, optedIn ? "Reminder turned on" : "Reminder turned off");
}

export async function refillToCartAction(planId: string) {
  return runAction("customer.refillToCart", async () => {
    const r = await addRefillToCart(await getActor(), planId);
    await selectPatient(r.familyMemberId);
    revalidatePath("/", "layout");
    return r;
  });
}

export async function reorderAction(orderId: string) {
  return runAction("customer.reorder", async () => {
    const r = await reorderToCart(await getActor(), orderId);
    await selectPatient(r.familyMemberId);
    revalidatePath("/", "layout");
    return r;
  });
}

export async function addFamilyMemberAction(input: { name: string; relation: string; yearOfBirth?: string }) {
  return runAction("customer.addFamily", async () => {
    const m = await addFamilyMember(await getActor(), {
      name: input.name,
      relation: input.relation as "OTHER",
      yearOfBirth: input.yearOfBirth ? Number(input.yearOfBirth) : undefined,
    });
    revalidatePath("/", "layout");
    return { id: m.id };
  }, "Family member added");
}

export async function updateProfileAction(input: { name: string; addressLine: string; localityId: string }) {
  return runAction("customer.profile", async () => {
    await updateCustomerProfile(await getActor(), input);
    revalidatePath("/", "layout");
  }, "Profile saved");
}
