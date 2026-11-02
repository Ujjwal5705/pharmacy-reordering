import "server-only";
import type { Role } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Actor } from "../actor";
import { config } from "../env";
import { findSessionUser, revokeSession } from "./otp";

export const SESSION_COOKIE = "rx_session";

export async function setSessionCookie(token: string, ttlHours: number) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config().isProductionLike,
    path: "/",
    maxAge: ttlHours * 3600,
  });
}

export async function clearSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  jar.delete(SESSION_COOKIE);
}

/** Current signed-in user as an Actor, or null. Cached per request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = await findSessionUser(token);
  if (!user) return null;
  return { id: user.id, role: user.role, name: user.name, storeId: user.storeId, pharmacistRegNo: user.pharmacistRegNo };
});

/** For pages: redirects to sign-in when signed out. Role mismatches are handled by the caller's UI. */
export async function requirePageActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

/**
 * Per-page role check. Layout checks alone are not a security boundary in the App Router
 * (a page segment can be fetched without its layout re-rendering), so data pages call this too.
 */
export async function requirePageRole(roles: Role[]): Promise<Actor> {
  const actor = await requirePageActor();
  if (!roles.includes(actor.role)) redirect(homeFor(actor.role));
  return actor;
}

export function homeFor(role: Role) {
  switch (role) {
    case "CUSTOMER":
      return "/";
    case "PHARMACIST":
      return "/pharmacist";
    case "STORE_STAFF":
      return "/store";
    case "OPS_ADMIN":
      return "/ops";
  }
}

/** Opaque per-client key for rate limiting (never stored raw). */
export async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}
