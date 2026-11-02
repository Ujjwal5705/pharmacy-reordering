import "server-only";
import { cookies } from "next/headers";
import type { Actor } from "./actor";
import { db } from "./db";

export const PATIENT_COOKIE = "rx_patient";

/** The family member the customer is currently ordering for; falls back to "self". Ownership-checked. */
export async function getSelectedPatient(actor: Actor) {
  const members = await db.familyMember.findMany({ where: { customerId: actor.id }, orderBy: [{ relation: "asc" }, { createdAt: "asc" }] });
  const wanted = (await cookies()).get(PATIENT_COOKIE)?.value;
  const selected = members.find((m) => m.id === wanted) ?? members.find((m) => m.relation === "SELF") ?? members[0] ?? null;
  return { members, selected };
}
