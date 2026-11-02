import "server-only";
import { NextResponse } from "next/server";
import { isDomainError, logUnexpected, type ErrorCode } from "./errors";

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
  if (isDomainError(e)) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: STATUS[e.code] ?? 400 });
  }
  logUnexpected(scope, e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again.", details: [] } }, { status: 500 });
}
