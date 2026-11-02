import type { OrderStatus, Role } from "@prisma/client";
import { DomainError } from "../errors";

export type TransitionActor = Role | "SYSTEM";

/**
 * Legal order transitions and who may trigger them. Anything not listed is rejected server-side.
 * Orders are created directly in AWAITING_PHARMACIST (any item needs a pharmacist) or APPROVED
 * (only non-prescription items).
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, TransitionActor[]>>> = {
  AWAITING_PHARMACIST: {
    APPROVED: ["PHARMACIST"],
    REJECTED: ["PHARMACIST"],
    NEEDS_REUPLOAD: ["PHARMACIST"],
    AWAITING_CUSTOMER_CONSENT: ["PHARMACIST"],
    CANCELLED: ["CUSTOMER", "OPS_ADMIN"],
  },
  NEEDS_REUPLOAD: {
    AWAITING_PHARMACIST: ["CUSTOMER"],
    CANCELLED: ["CUSTOMER", "OPS_ADMIN"],
  },
  // Consent only finalises a substitution the pharmacist already approved; the approval gate
  // still requires a pharmacist review for every prescription item before APPROVED.
  AWAITING_CUSTOMER_CONSENT: {
    APPROVED: ["CUSTOMER"],
    AWAITING_PHARMACIST: ["CUSTOMER"],
    CANCELLED: ["CUSTOMER", "OPS_ADMIN"],
  },
  APPROVED: {
    PICKING: ["STORE_STAFF", "OPS_ADMIN"],
    CANCELLED: ["CUSTOMER", "OPS_ADMIN"],
  },
  PICKING: { PACKED: ["STORE_STAFF", "OPS_ADMIN"] },
  PACKED: { HANDED_TO_DELIVERY: ["STORE_STAFF", "OPS_ADMIN"] },
  HANDED_TO_DELIVERY: { DELIVERED: ["STORE_STAFF", "OPS_ADMIN"] },
  DELIVERED: {},
  REJECTED: {},
  CANCELLED: {},
};

export const TERMINAL_STATUSES: OrderStatus[] = ["DELIVERED", "REJECTED", "CANCELLED"];
export const DISPATCH_STATUSES: OrderStatus[] = ["PICKING", "PACKED", "HANDED_TO_DELIVERY", "DELIVERED"];

export function canTransition(from: OrderStatus, to: OrderStatus, actor: TransitionActor) {
  return ORDER_TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export function assertTransition(from: OrderStatus, to: OrderStatus, actor: TransitionActor) {
  const allowed = ORDER_TRANSITIONS[from][to];
  if (!allowed) {
    throw new DomainError("INVALID_TRANSITION", `An order cannot move from ${label(from)} to ${label(to)}.`);
  }
  if (!allowed.includes(actor)) {
    throw new DomainError("FORBIDDEN", `Your role cannot move an order to ${label(to)}.`);
  }
}

function label(s: OrderStatus) {
  return s.toLowerCase().replaceAll("_", " ");
}
