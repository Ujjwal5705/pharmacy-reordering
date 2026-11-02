import { describe, expect, it } from "vitest";
import { evaluateApprovalGate, evaluateDispatchGate, type GateItem, type GateOrder } from "@/server/domain/gates";
import { assertTransition, canTransition } from "@/server/domain/order-state";
import { decidePolicy, type PolicyRule } from "@/server/domain/policy";

const ruleFor = (category: PolicyRule["category"], over: Partial<PolicyRule> = {}): PolicyRule => ({
  id: category,
  category,
  version: 1,
  effectiveFrom: new Date("2026-01-01"),
  effectiveTo: null,
  onlineOrderable: !["SCHEDULE_X", "NARCOTIC"].includes(category),
  prescriptionRequired: category !== "OTC",
  pharmacistApprovalRequired: category !== "OTC",
  h1RegisterRequired: category === "SCHEDULE_H1",
  ...over,
});

const item = (over: Partial<GateItem> = {}): GateItem => ({
  id: "i1",
  label: "Metformin 500 mg",
  status: "APPROVED",
  prescriptionRequired: true,
  pharmacistApprovalRequired: true,
  h1RegisterRequired: false,
  approvedByReviewId: "r1",
  hasH1Entry: false,
  substituted: false,
  substitutionConsented: false,
  livePolicy: decidePolicy("SCHEDULE_H", ruleFor("SCHEDULE_H")),
  allocatedQty: 4,
  approvedQuantity: 4,
  quantity: 4,
  ...over,
});

const order = (items: GateItem[], over: Partial<GateOrder> = {}): GateOrder => ({
  status: "APPROVED",
  routingStatus: "ROUTED",
  storeId: "s1",
  prescriptionId: "rx1",
  hasPendingSubstitution: false,
  items,
  ...over,
});

describe("order state machine", () => {
  it("lets only a pharmacist approve, reject or request re-upload", () => {
    for (const to of ["APPROVED", "REJECTED", "NEEDS_REUPLOAD"] as const) {
      expect(canTransition("AWAITING_PHARMACIST", to, "PHARMACIST")).toBe(true);
      expect(canTransition("AWAITING_PHARMACIST", to, "CUSTOMER")).toBe(false);
      expect(canTransition("AWAITING_PHARMACIST", to, "STORE_STAFF")).toBe(false);
      expect(canTransition("AWAITING_PHARMACIST", to, "OPS_ADMIN")).toBe(false);
      expect(canTransition("AWAITING_PHARMACIST", to, "SYSTEM")).toBe(false);
    }
  });

  it("cannot skip pharmacist review straight to picking", () => {
    expect(() => assertTransition("AWAITING_PHARMACIST", "PICKING", "STORE_STAFF")).toThrow(/cannot move/);
    expect(() => assertTransition("NEEDS_REUPLOAD", "PICKING", "OPS_ADMIN")).toThrow(/cannot move/);
    expect(() => assertTransition("AWAITING_CUSTOMER_CONSENT", "PICKING", "STORE_STAFF")).toThrow(/cannot move/);
  });

  it("follows pick → pack → hand over → delivered for store staff", () => {
    expect(canTransition("APPROVED", "PICKING", "STORE_STAFF")).toBe(true);
    expect(canTransition("PICKING", "PACKED", "STORE_STAFF")).toBe(true);
    expect(canTransition("PACKED", "HANDED_TO_DELIVERY", "STORE_STAFF")).toBe(true);
    expect(canTransition("HANDED_TO_DELIVERY", "DELIVERED", "STORE_STAFF")).toBe(true);
    expect(canTransition("APPROVED", "PACKED", "STORE_STAFF")).toBe(false);
    expect(canTransition("PICKING", "PACKED", "CUSTOMER")).toBe(false);
  });

  it("treats delivered, rejected and cancelled as terminal", () => {
    for (const from of ["DELIVERED", "REJECTED", "CANCELLED"] as const) {
      for (const to of ["APPROVED", "PICKING", "AWAITING_PHARMACIST", "CANCELLED"] as const) {
        expect(canTransition(from, to, "OPS_ADMIN")).toBe(false);
      }
    }
  });

  it("only lets a customer re-submit after a re-upload request", () => {
    expect(canTransition("NEEDS_REUPLOAD", "AWAITING_PHARMACIST", "CUSTOMER")).toBe(true);
    expect(canTransition("NEEDS_REUPLOAD", "AWAITING_PHARMACIST", "PHARMACIST")).toBe(false);
  });
});

describe("approval and dispatch gates", () => {
  it("allows a fully approved, routed order", () => {
    expect(evaluateDispatchGate(order([item()]))).toEqual({ allowed: true, violations: [] });
  });

  it("blocks Schedule H dispatch without a pharmacist approval", () => {
    const g = evaluateDispatchGate(order([item({ status: "PENDING_REVIEW", approvedByReviewId: null })]));
    expect(g.allowed).toBe(false);
    expect(g.violations.join()).toMatch(/not been approved by a pharmacist/);
  });

  it("blocks an item marked APPROVED but with no pharmacist review behind it", () => {
    expect(evaluateApprovalGate(order([item({ approvedByReviewId: null })])).allowed).toBe(false);
  });

  it("blocks prescription items when no prescription is attached", () => {
    expect(evaluateApprovalGate(order([item()], { prescriptionId: null })).violations.join()).toMatch(/needs a prescription/);
  });

  it("blocks Schedule H1 without an H1 register entry, allows it with one", () => {
    const h1 = { h1RegisterRequired: true, livePolicy: decidePolicy("SCHEDULE_H1", ruleFor("SCHEDULE_H1")) };
    expect(evaluateDispatchGate(order([item({ ...h1, hasH1Entry: false })])).violations.join()).toMatch(/H1 register/);
    expect(evaluateDispatchGate(order([item({ ...h1, hasH1Entry: true })])).allowed).toBe(true);
  });

  it("blocks Schedule X and narcotic items regardless of approval state", () => {
    for (const c of ["SCHEDULE_X", "NARCOTIC"] as const) {
      const g = evaluateDispatchGate(order([item({ livePolicy: decidePolicy(c, ruleFor(c)) })]));
      expect(g.allowed).toBe(false);
      expect(g.violations.join()).toMatch(/cannot be sold online/);
    }
  });

  it("re-checks the live policy: an item approved before a rule change is blocked after it", () => {
    const tightened = decidePolicy("SCHEDULE_H", ruleFor("SCHEDULE_H", { onlineOrderable: false }));
    expect(evaluateDispatchGate(order([item({ livePolicy: tightened })])).allowed).toBe(false);
  });

  it("blocks a substitution without pharmacist approval + customer consent", () => {
    expect(evaluateDispatchGate(order([item({ substituted: true, substitutionConsented: false })])).violations.join()).toMatch(/substituted without/);
    expect(evaluateDispatchGate(order([item({ substituted: true, substitutionConsented: true })])).allowed).toBe(true);
  });

  it("blocks while a substitution is awaiting consent", () => {
    expect(evaluateApprovalGate(order([item()], { hasPendingSubstitution: true })).allowed).toBe(false);
  });

  it("blocks dispatch when the order is not routed or stock is not reserved", () => {
    expect(evaluateDispatchGate(order([item()], { routingStatus: "NO_STOCK", storeId: null })).allowed).toBe(false);
    expect(evaluateDispatchGate(order([item({ allocatedQty: 2 })])).violations.join()).toMatch(/reserved stock/);
  });

  it("ignores rejected items but blocks an order with nothing left", () => {
    const rejected = item({ status: "REJECTED", approvedByReviewId: null, allocatedQty: 0 });
    expect(evaluateDispatchGate(order([item({ id: "ok" }), rejected])).allowed).toBe(true);
    expect(evaluateApprovalGate(order([rejected])).violations).toContain("No items remain on this order.");
  });

  it("lets OTC items through without a pharmacist", () => {
    const otc = item({ status: "NOT_REQUIRED", prescriptionRequired: false, pharmacistApprovalRequired: false, approvedByReviewId: null, livePolicy: decidePolicy("OTC", ruleFor("OTC")) });
    expect(evaluateDispatchGate(order([otc], { prescriptionId: null })).allowed).toBe(true);
  });
});
