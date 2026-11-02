import type { Role } from "@prisma/client";
import { DomainError } from "./errors";

export type Actor = {
  id: string;
  role: Role;
  name: string;
  storeId: string | null;
  pharmacistRegNo: string | null;
};

export function assertRole(actor: Actor | null, roles: Role[]): asserts actor is Actor {
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.");
  if (!roles.includes(actor.role)) throw new DomainError("FORBIDDEN", "Your account does not have access to this action.");
}

/** A registered pharmacist is a PHARMACIST account with a council registration number on file. */
export function assertRegisteredPharmacist(actor: Actor | null): asserts actor is Actor {
  assertRole(actor, ["PHARMACIST"]);
  if (!actor.pharmacistRegNo) {
    throw new DomainError("FORBIDDEN", "Only a registered pharmacist can make prescription decisions.");
  }
}

/** Store-bound staff and pharmacists may only act on orders routed to their store. */
export function canAccessStore(actor: Actor, storeId: string | null): boolean {
  if (actor.role === "OPS_ADMIN") return true;
  if (actor.role === "PHARMACIST") return actor.storeId === null || actor.storeId === storeId;
  if (actor.role === "STORE_STAFF") return actor.storeId !== null && actor.storeId === storeId;
  return false;
}
