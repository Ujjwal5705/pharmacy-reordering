import type { OrderItemStatus, OrderStatus, RoutingStatus } from "@prisma/client";
import type { PolicyDecision } from "./policy";

export type GateItem = {
  id: string;
  label: string;
  status: OrderItemStatus;
  prescriptionRequired: boolean;
  pharmacistApprovalRequired: boolean;
  h1RegisterRequired: boolean;
  /** Review that approved this item. Must belong to a registered pharmacist (checked by caller). */
  approvedByReviewId: string | null;
  hasH1Entry: boolean;
  /** Product changed from what the customer requested. */
  substituted: boolean;
  /** An ACCEPTED proposal by a pharmacist, with a granted customer consent record. */
  substitutionConsented: boolean;
  /** Live policy decision at evaluation time (rules may have changed since submission). */
  livePolicy: PolicyDecision;
  /** Packs held or already consumed for this item at the routed store. */
  allocatedQty: number;
  approvedQuantity: number | null;
  quantity: number;
};

export type GateOrder = {
  status: OrderStatus;
  routingStatus: RoutingStatus;
  storeId: string | null;
  prescriptionId: string | null;
  hasPendingSubstitution: boolean;
  items: GateItem[];
};

export type GateResult = { allowed: boolean; violations: string[] };

/** Everything that must hold before an order may be APPROVED. */
export function evaluateApprovalGate(order: GateOrder): GateResult {
  const v: string[] = [];
  const active = order.items.filter((i) => i.status !== "REJECTED");
  if (active.length === 0) v.push("No items remain on this order.");
  if (order.hasPendingSubstitution) v.push("A generic substitution is still awaiting customer consent.");

  for (const item of active) {
    if (!item.livePolicy.orderable) v.push(`${item.label} cannot be sold online.`);
    if (item.pharmacistApprovalRequired || item.livePolicy.pharmacistApprovalRequired) {
      if (item.status !== "APPROVED" || !item.approvedByReviewId) {
        v.push(`${item.label} has not been approved by a pharmacist.`);
      }
    } else if (item.status !== "NOT_REQUIRED" && item.status !== "APPROVED") {
      v.push(`${item.label} is not ready.`);
    }
    if ((item.prescriptionRequired || item.livePolicy.prescriptionRequired) && !order.prescriptionId) {
      v.push(`${item.label} needs a prescription on the order.`);
    }
    if ((item.h1RegisterRequired || item.livePolicy.h1RegisterRequired) && !item.hasH1Entry) {
      v.push(`${item.label} needs an H1 register entry.`);
    }
    if (item.substituted && !item.substitutionConsented) {
      v.push(`${item.label} was substituted without recorded pharmacist approval and customer consent.`);
    }
  }
  return { allowed: v.length === 0, violations: v };
}

/** Approval gate plus routing/stock checks. Evaluated at every step from picking to handover. */
export function evaluateDispatchGate(order: GateOrder): GateResult {
  const approval = evaluateApprovalGate(order);
  const v = [...approval.violations];
  if (order.routingStatus !== "ROUTED" || !order.storeId) v.push("Order has not been routed to a store with stock.");
  for (const item of order.items.filter((i) => i.status !== "REJECTED")) {
    const needed = item.approvedQuantity ?? item.quantity;
    if (item.allocatedQty < needed) v.push(`${item.label} does not have reserved stock.`);
  }
  return { allowed: v.length === 0, violations: v };
}
