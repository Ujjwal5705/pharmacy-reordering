import { ZodError } from "zod";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "POLICY_BLOCKED"
  | "INVALID_TRANSITION"
  | "APPROVAL_BLOCKED"
  | "DISPATCH_BLOCKED"
  | "RATE_LIMITED"
  | "NO_STOCK"
  | "CONFIG";

/** Expected, user-presentable failure. Messages must never contain health details or secrets. */
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

/** Schema failures from service-level validation are user errors, not server faults. */
export function asDomainError(e: unknown): DomainError | null {
  if (e instanceof DomainError) return e;
  if (e instanceof ZodError) {
    const details = [...new Set(e.issues.map((i) => i.message))];
    return new DomainError("VALIDATION", details.length === 1 ? details[0] : "Please check the details and try again.", details.length === 1 ? [] : details);
  }
  return null;
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: { code: ErrorCode | "INTERNAL"; message: string; details: string[] } };

/** Logs an unexpected error without request payloads, file contents or personal data. */
export function logUnexpected(scope: string, e: unknown) {
  const name = e instanceof Error ? e.name : typeof e;
  const prismaCode = (e as { code?: unknown })?.code;
  console.error(`[${scope}] unexpected ${name}${typeof prismaCode === "string" ? ` (${prismaCode})` : ""}`);
}

export async function runAction<T>(scope: string, fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (e) {
    const known = asDomainError(e);
    if (known) return { ok: false, error: { code: known.code, message: known.message, details: known.details } };
    // Next.js uses thrown errors for redirect()/notFound(); let those propagate.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) {
      throw e;
    }
    logUnexpected(scope, e);
    return {
      ok: false,
      error: { code: "INTERNAL", message: "Something went wrong. Nothing was changed — please try again.", details: [] },
    };
  }
}
