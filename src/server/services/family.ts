import { z } from "zod";
import { assertRole, type Actor } from "../actor";
import { db } from "../db";
import { DomainError } from "../errors";

export const familyMemberSchema = z.object({
  name: z.string().trim().min(2, "Enter the patient's name.").max(80),
  relation: z.enum(["SELF", "MOTHER", "FATHER", "SPOUSE", "CHILD", "SIBLING", "GRANDPARENT", "OTHER"]),
  yearOfBirth: z.coerce
    .number()
    .int()
    .min(1900, "Enter a valid year of birth.")
    .max(new Date().getFullYear(), "Enter a valid year of birth.")
    .optional(),
});
export const MAX_FAMILY_MEMBERS = 8;

export async function addFamilyMember(actor: Actor | null, raw: z.input<typeof familyMemberSchema>) {
  assertRole(actor, ["CUSTOMER"]);
  const input = familyMemberSchema.parse(raw);
  const count = await db.familyMember.count({ where: { customerId: actor.id } });
  if (count >= MAX_FAMILY_MEMBERS) throw new DomainError("VALIDATION", `You can add up to ${MAX_FAMILY_MEMBERS} people.`);
  return db.familyMember.create({ data: { ...input, customerId: actor.id } });
}

export async function updateFamilyMember(actor: Actor | null, id: string, raw: z.input<typeof familyMemberSchema>) {
  assertRole(actor, ["CUSTOMER"]);
  const input = familyMemberSchema.parse(raw);
  const res = await db.familyMember.updateMany({ where: { id, customerId: actor.id }, data: input });
  if (res.count !== 1) throw new DomainError("NOT_FOUND", "Patient profile not found.");
}

export async function updateCustomerProfile(actor: Actor | null, raw: { name: string; addressLine: string; localityId: string }) {
  assertRole(actor, ["CUSTOMER"]);
  const input = z
    .object({
      name: z.string().trim().min(2, "Enter your name.").max(80),
      addressLine: z.string().trim().min(6, "Enter your delivery address.").max(200),
      localityId: z.string().min(1, "Choose your area."),
    })
    .parse(raw);
  const locality = await db.locality.findUnique({ where: { id: input.localityId } });
  if (!locality) throw new DomainError("VALIDATION", "Choose your area.");
  await db.user.update({
    where: { id: actor.id },
    data: { name: input.name, addressLine: input.addressLine, defaultLocalityId: locality.id },
  });
}
