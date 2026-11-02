import { z } from "zod";
import { assertRole, type Actor } from "../actor";
import { db } from "../db";
import { evaluateCategory } from "../domain/policy";
import { DomainError } from "../errors";
import { loadPolicyRules } from "./catalogue";

export const MAX_PACKS_PER_ITEM = 20;

async function ownedMember(actor: Actor, familyMemberId: string) {
  const member = await db.familyMember.findFirst({ where: { id: familyMemberId, customerId: actor.id } });
  if (!member) throw new DomainError("NOT_FOUND", "Patient profile not found.");
  return member;
}

/** Adds one pack (or `quantity`) of a product. Products that cannot be sold online are refused here too. */
export async function addToCart(actor: Actor | null, familyMemberId: string, productId: string, quantity = 1) {
  assertRole(actor, ["CUSTOMER"]);
  const qty = z.number().int().min(1).max(MAX_PACKS_PER_ITEM).parse(quantity);
  await ownedMember(actor, familyMemberId);
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product || !product.active) throw new DomainError("NOT_FOUND", "Product not found.");
  const decision = evaluateCategory(await loadPolicyRules(db), product.category);
  if (!decision.orderable) {
    throw new DomainError("POLICY_BLOCKED", `${product.name} cannot be ordered online. Please visit a store with your prescription.`);
  }
  const existing = await db.cartItem.findUnique({ where: { familyMemberId_productId: { familyMemberId, productId } } });
  const next = Math.min(MAX_PACKS_PER_ITEM, (existing?.quantity ?? 0) + qty);
  await db.cartItem.upsert({
    where: { familyMemberId_productId: { familyMemberId, productId } },
    create: { customerId: actor.id, familyMemberId, productId, quantity: next },
    update: { quantity: next },
  });
  return { quantity: next };
}

/** Sets an exact quantity; 0 removes the line. */
export async function setCartQuantity(actor: Actor | null, familyMemberId: string, productId: string, quantity: number) {
  assertRole(actor, ["CUSTOMER"]);
  const qty = z.number().int().min(0).max(MAX_PACKS_PER_ITEM).parse(quantity);
  await ownedMember(actor, familyMemberId);
  if (qty === 0) {
    await db.cartItem.deleteMany({ where: { customerId: actor.id, familyMemberId, productId } });
    return;
  }
  const res = await db.cartItem.updateMany({ where: { customerId: actor.id, familyMemberId, productId }, data: { quantity: qty } });
  if (res.count !== 1) throw new DomainError("NOT_FOUND", "Item is not in the cart.");
}
