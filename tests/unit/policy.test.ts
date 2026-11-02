import { describe, expect, it } from "vitest";
import { decidePolicy, evaluateCategory, resolvePolicy, validatePolicyDraft, type PolicyRule } from "@/server/domain/policy";

const rule = (over: Partial<PolicyRule>): PolicyRule => ({
  id: "p",
  category: "SCHEDULE_H",
  version: 1,
  effectiveFrom: new Date("2026-01-01"),
  effectiveTo: null,
  onlineOrderable: true,
  prescriptionRequired: true,
  pharmacistApprovalRequired: true,
  h1RegisterRequired: false,
  ...over,
});

describe("medicine policy by schedule category", () => {
  const rules: PolicyRule[] = [
    rule({ id: "otc", category: "OTC", prescriptionRequired: false, pharmacistApprovalRequired: false }),
    rule({ id: "h", category: "SCHEDULE_H" }),
    rule({ id: "h1", category: "SCHEDULE_H1", h1RegisterRequired: true }),
    rule({ id: "x", category: "SCHEDULE_X", onlineOrderable: false }),
    rule({ id: "n", category: "NARCOTIC", onlineOrderable: false }),
  ];

  it("allows OTC without prescription or pharmacist", () => {
    expect(evaluateCategory(rules, "OTC")).toMatchObject({ orderable: true, prescriptionRequired: false, pharmacistApprovalRequired: false });
  });

  it("requires prescription and pharmacist approval for Schedule H", () => {
    expect(evaluateCategory(rules, "SCHEDULE_H")).toMatchObject({ orderable: true, prescriptionRequired: true, pharmacistApprovalRequired: true, h1RegisterRequired: false });
  });

  it("requires the H1 register for Schedule H1", () => {
    expect(evaluateCategory(rules, "SCHEDULE_H1")).toMatchObject({ orderable: true, prescriptionRequired: true, h1RegisterRequired: true });
  });

  it.each(["SCHEDULE_X", "NARCOTIC"] as const)("blocks %s from online sale", (c) => {
    expect(evaluateCategory(rules, c)).toMatchObject({ orderable: false, blockReason: "NOT_SOLD_ONLINE" });
  });

  it("keeps Schedule X blocked even if a misconfigured rule says orderable (statutory floor)", () => {
    const bad = rule({ category: "SCHEDULE_X", onlineOrderable: true, prescriptionRequired: false, pharmacistApprovalRequired: false });
    expect(decidePolicy("SCHEDULE_X", bad)).toMatchObject({ orderable: false, prescriptionRequired: true, pharmacistApprovalRequired: true });
  });

  it("keeps prescription + pharmacist + register requirements for H1 even if a rule omits them", () => {
    const bad = rule({ category: "SCHEDULE_H1", prescriptionRequired: false, pharmacistApprovalRequired: false, h1RegisterRequired: false });
    expect(decidePolicy("SCHEDULE_H1", bad)).toMatchObject({ prescriptionRequired: true, pharmacistApprovalRequired: true, h1RegisterRequired: true });
  });

  it("fails closed when no policy is active for a category", () => {
    expect(evaluateCategory([], "OTC")).toMatchObject({ orderable: false, blockReason: "NO_ACTIVE_POLICY", pharmacistApprovalRequired: true });
  });
});

describe("versioned, effective-dated policies", () => {
  const v1 = rule({ id: "v1", version: 1, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-07-01") });
  const v2 = rule({ id: "v2", version: 2, effectiveFrom: new Date("2026-07-01"), onlineOrderable: false });

  it("picks the version whose window contains the date", () => {
    expect(resolvePolicy([v1, v2], "SCHEDULE_H", new Date("2026-03-01"))?.id).toBe("v1");
    expect(resolvePolicy([v1, v2], "SCHEDULE_H", new Date("2026-08-01"))?.id).toBe("v2");
  });

  it("prefers the highest version when windows overlap", () => {
    const v3 = rule({ id: "v3", version: 3, effectiveFrom: new Date("2026-01-01") });
    expect(resolvePolicy([v1, v3], "SCHEDULE_H", new Date("2026-03-01"))?.id).toBe("v3");
  });

  it("ignores rules that have not started yet", () => {
    const future = rule({ id: "f", effectiveFrom: new Date("2030-01-01") });
    expect(resolvePolicy([future], "SCHEDULE_H", new Date("2026-03-01"))).toBeNull();
  });
});

describe("policy draft validation", () => {
  const draft = { category: "SCHEDULE_H" as const, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, onlineOrderable: true, prescriptionRequired: true, pharmacistApprovalRequired: true, h1RegisterRequired: false };

  it("accepts a valid stricter-or-equal policy", () => {
    expect(validatePolicyDraft(draft)).toEqual([]);
  });
  it("rejects selling Schedule X or narcotics online", () => {
    expect(validatePolicyDraft({ ...draft, category: "SCHEDULE_X" })).toContain("SCHEDULE_X medicines cannot be sold online.");
    expect(validatePolicyDraft({ ...draft, category: "NARCOTIC" })).toContain("NARCOTIC medicines cannot be sold online.");
  });
  it("rejects dropping the prescription requirement for Schedule H", () => {
    expect(validatePolicyDraft({ ...draft, prescriptionRequired: false }).length).toBeGreaterThan(0);
  });
  it("rejects dropping the H1 register", () => {
    expect(validatePolicyDraft({ ...draft, category: "SCHEDULE_H1", h1RegisterRequired: false })).toContain(
      "Schedule H1 supplies must be entered in the H1 register.",
    );
  });
  it("rejects an inverted effective window", () => {
    expect(validatePolicyDraft({ ...draft, effectiveTo: new Date("2025-01-01") })).toContain("Effective-to date must be after effective-from date.");
  });
});
