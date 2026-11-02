import "server-only";
import { NextResponse } from "next/server";
import { asDomainError, logUnexpected, type ErrorCode } from "./errors";

const STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  CONFIG: 503,
};

/**
 * CSRF guard for mutating route handlers: the browser-sent Origin must match this host.
 * (Server Actions get the same check from Next.js.) Cookies are also SameSite=Lax.
 */
export function isSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function errorResponse(scope: string, e: unknown) {
  const known = asDomainError(e);
  if (known) {
    return NextResponse.json({ error: { code: known.code, message: known.message, details: known.details } }, { status: STATUS[known.code] ?? 400 });
  }
  logUnexpected(scope, e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again.", details: [] } }, { status: 500 });
}
