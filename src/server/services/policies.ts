import { z } from "zod";
import { assertRole, type Actor } from "../actor";
import { audit } from "../audit";
import { db } from "../db";
import { validatePolicyDraft } from "../domain/policy";
import { DomainError } from "../errors";

export const policyDraftSchema = z.object({
  category: z.enum(["OTC", "SCHEDULE_H", "SCHEDULE_H1", "SCHEDULE_X", "NARCOTIC"]),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullable(),
  onlineOrderable: z.boolean(),
  prescriptionRequired: z.boolean(),
  pharmacistApprovalRequired: z.boolean(),
  h1RegisterRequired: z.boolean(),
  description: z.string().trim().min(5, "Describe why this version exists.").max(300),
});

/** Adds a new version for a category. Old versions stay for history; the resolver picks by date and version. */
export async function createPolicyVersion(actor: Actor | null, raw: z.input<typeof policyDraftSchema>) {
  assertRole(actor, ["OPS_ADMIN"]);
  const draft = policyDraftSchema.parse(raw);
  const errors = validatePolicyDraft(draft);
  if (errors.length) throw new DomainError("VALIDATION", "This policy breaks a rule that cannot be relaxed.", errors);
  return db.$transaction(async (tx) => {
    const latest = await tx.medicinePolicy.findFirst({ where: { category: draft.category }, orderBy: { version: "desc" } });
    const created = await tx.medicinePolicy.create({
      data: { ...draft, version: (latest?.version ?? 0) + 1, createdById: actor.id },
    });
    await audit(tx, {
      actor,
      action: "POLICY_VERSION_CREATED",
      entityType: "MedicinePolicy",
      entityId: created.id,
      metadata: { category: created.category, version: created.version, onlineOrderable: created.onlineOrderable },
    });
    return created;
  });
}
