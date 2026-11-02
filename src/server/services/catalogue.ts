import type { MedicineCategory } from "@prisma/client";
import type { DbClient } from "../db";
import { evaluateCategory, type PolicyDecision, type PolicyRule } from "../domain/policy";
import type { CatalogueEntry } from "../extraction/matcher";

export async function loadPolicyRules(client: DbClient): Promise<PolicyRule[]> {
  const rows = await client.medicinePolicy.findMany();
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    version: r.version,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    onlineOrderable: r.onlineOrderable,
    prescriptionRequired: r.prescriptionRequired,
    pharmacistApprovalRequired: r.pharmacistApprovalRequired,
    h1RegisterRequired: r.h1RegisterRequired,
  }));
}

/** Policy decision for every category at one instant, so a request evaluates one consistent rule set. */
export async function loadPolicyDecisions(client: DbClient, at: Date = new Date()) {
  const rules = await loadPolicyRules(client);
  const categories: MedicineCategory[] = ["OTC", "SCHEDULE_H", "SCHEDULE_H1", "SCHEDULE_X", "NARCOTIC"];
  return Object.fromEntries(categories.map((c) => [c, evaluateCategory(rules, c, at)])) as Record<
    MedicineCategory,
    PolicyDecision
  >;
}

export async function loadCatalogueForMatching(client: DbClient): Promise<CatalogueEntry[]> {
  const products = await client.product.findMany({
    where: { active: true },
    select: { id: true, name: true, molecule: true, strength: true, form: true, genericGroup: true, active: true },
  });
  return products;
}
