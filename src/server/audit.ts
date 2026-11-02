import type { Prisma } from "@prisma/client";
import type { Actor } from "./actor";
import type { DbClient } from "./db";

export type AuditAction =
  | "AUTH_OTP_REQUESTED"
  | "AUTH_LOGIN_SUCCEEDED"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_LOGOUT"
  | "ACCESS_DENIED"
  | "PRESCRIPTION_UPLOADED"
  | "PRESCRIPTION_FILE_VIEWED"
  | "PRESCRIPTION_EXTRACTION_RUN"
  | "PRESCRIPTION_REVIEW_OPENED"
  | "PRESCRIPTION_REVIEW_SUBMITTED"
  | "H1_REGISTER_RECORDED"
  | "SUBSTITUTION_PROPOSED"
  | "SUBSTITUTION_CONSENT_RECORDED"
  | "ORDER_SUBMITTED"
  | "ORDER_STATUS_CHANGED"
  | "ORDER_ROUTED"
  | "ORDER_ROUTING_NO_STOCK"
  | "STOCK_IMPORT_PREVIEWED"
  | "STOCK_IMPORT_APPLIED"
  | "POLICY_VERSION_CREATED"
  | "REFILL_OPT_IN_CHANGED";

/**
 * Append an audit event. Metadata must hold identifiers and codes only — never prescription
 * contents, OCR text, dosage or diagnosis details.
 */
export async function audit(
  client: DbClient,
  event: {
    actor: Pick<Actor, "id" | "role"> | null;
    action: AuditAction;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  await client.auditEvent.create({
    data: {
      actorId: event.actor?.id ?? null,
      actorRole: event.actor?.role ?? "SYSTEM",
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata,
    },
  });
}
