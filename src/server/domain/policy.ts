import type { MedicineCategory } from "@prisma/client";

export type PolicyRule = {
  id: string;
  category: MedicineCategory;
  version: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  onlineOrderable: boolean;
  prescriptionRequired: boolean;
  pharmacistApprovalRequired: boolean;
  h1RegisterRequired: boolean;
};

export type PolicyDecision = {
  policyId: string | null;
  orderable: boolean;
  blockReason: null | "NO_ACTIVE_POLICY" | "NOT_SOLD_ONLINE";
  prescriptionRequired: boolean;
  pharmacistApprovalRequired: boolean;
  h1RegisterRequired: boolean;
};

/**
 * Statutory floor taken from the brief. Configured policies can be stricter, never looser.
 * This is the single place these category rules live; the DB has a matching CHECK constraint.
 */
export const STATUTORY_FLOOR: Record<
  MedicineCategory,
  { mayBeOrderableOnline: boolean; prescriptionRequired: boolean; h1RegisterRequired: boolean }
> = {
  OTC: { mayBeOrderableOnline: true, prescriptionRequired: false, h1RegisterRequired: false },
  SCHEDULE_H: { mayBeOrderableOnline: true, prescriptionRequired: true, h1RegisterRequired: false },
  SCHEDULE_H1: { mayBeOrderableOnline: true, prescriptionRequired: true, h1RegisterRequired: true },
  SCHEDULE_X: { mayBeOrderableOnline: false, prescriptionRequired: true, h1RegisterRequired: false },
  NARCOTIC: { mayBeOrderableOnline: false, prescriptionRequired: true, h1RegisterRequired: false },
};

export function resolvePolicy(rules: PolicyRule[], category: MedicineCategory, at: Date = new Date()) {
  const active = rules
    .filter(
      (r) =>
        r.category === category &&
        r.effectiveFrom.getTime() <= at.getTime() &&
        (r.effectiveTo === null || at.getTime() < r.effectiveTo.getTime()),
    )
    .sort((a, b) => b.version - a.version);
  return active[0] ?? null;
}

/** Fails closed: no active rule means the category cannot be ordered online. */
export function decidePolicy(category: MedicineCategory, rule: PolicyRule | null): PolicyDecision {
  const floor = STATUTORY_FLOOR[category];
  if (!rule) {
    return {
      policyId: null,
      orderable: false,
      blockReason: "NO_ACTIVE_POLICY",
      prescriptionRequired: true,
      pharmacistApprovalRequired: true,
      h1RegisterRequired: floor.h1RegisterRequired,
    };
  }
  const orderable = rule.onlineOrderable && floor.mayBeOrderableOnline;
  const prescriptionRequired = rule.prescriptionRequired || floor.prescriptionRequired;
  return {
    policyId: rule.id,
    orderable,
    blockReason: orderable ? null : "NOT_SOLD_ONLINE",
    prescriptionRequired,
    pharmacistApprovalRequired: rule.pharmacistApprovalRequired || prescriptionRequired,
    h1RegisterRequired: rule.h1RegisterRequired || floor.h1RegisterRequired,
  };
}

export function evaluateCategory(rules: PolicyRule[], category: MedicineCategory, at: Date = new Date()) {
  return decidePolicy(category, resolvePolicy(rules, category, at));
}

export type PolicyDraft = Omit<PolicyRule, "id" | "version">;

/** Validation for new policy versions entered by operations. */
export function validatePolicyDraft(draft: PolicyDraft): string[] {
  const floor = STATUTORY_FLOOR[draft.category];
  const errors: string[] = [];
  if (draft.onlineOrderable && !floor.mayBeOrderableOnline) {
    errors.push(`${draft.category} medicines cannot be sold online.`);
  }
  if (floor.prescriptionRequired && !draft.prescriptionRequired) {
    errors.push(`${draft.category} medicines always require a valid prescription.`);
  }
  if (draft.prescriptionRequired && !draft.pharmacistApprovalRequired) {
    errors.push("Prescription-only categories must require pharmacist approval.");
  }
  if (floor.h1RegisterRequired && !draft.h1RegisterRequired) {
    errors.push("Schedule H1 supplies must be entered in the H1 register.");
  }
  if (draft.effectiveTo && draft.effectiveTo.getTime() <= draft.effectiveFrom.getTime()) {
    errors.push("Effective-to date must be after effective-from date.");
  }
  return errors;
}
