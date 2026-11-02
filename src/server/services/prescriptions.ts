import { assertRole, canAccessStore, type Actor } from "../actor";
import { audit } from "../audit";
import { db, type Tx } from "../db";
import { config } from "../env";
import { DomainError } from "../errors";
import { runExtraction } from "../extraction/pipeline";
import { getExtractionProvider } from "../extraction/registry";
import type { ExtractionOutcome } from "../extraction/types";
import { validatePrescriptionFile } from "../prescriptions/file-validation";
import { newStorageKey, readDecrypted, removeStored, storeEncrypted } from "../prescriptions/storage";
import { enforceRateLimit } from "../rate-limit";
import { loadCatalogueForMatching } from "./catalogue";

export const UPLOADS_PER_HOUR = 20;

async function persistExtraction(tx: Tx, prescriptionId: string, outcome: ExtractionOutcome) {
  return tx.extractionRun.create({
    data: {
      prescriptionId,
      provider: outcome.provider,
      status: outcome.status,
      overallConfidence: outcome.overallConfidence,
      errorCode: outcome.errorCode,
      durationMs: outcome.durationMs,
      fields: { create: outcome.fields.map((f) => ({ key: f.key, value: f.value, confidence: f.confidence })) },
      lines: {
        create: outcome.lines.map((l) => ({
          lineIndex: l.lineIndex,
          medicineName: l.medicineName,
          nameConfidence: l.nameConfidence,
          strength: l.strength,
          strengthConfidence: l.strengthConfidence,
          form: l.form,
          dosageText: l.dosageText,
          unitsPerDay: l.unitsPerDay,
          dosageConfidence: l.dosageConfidence,
          durationDays: l.durationDays,
          durationConfidence: l.durationConfidence,
          quantityUnits: l.quantityUnits,
          quantityConfidence: l.quantityConfidence,
          quantityDerived: l.quantityDerived,
          matchStatus: l.matchStatus,
          matchedProductId: l.matchedProductId,
          matchScore: l.matchScore,
          matchReason: l.matchReason,
          candidates: l.candidates,
        })),
      },
    },
  });
}

/**
 * Validates, encrypts and stores a prescription, then runs automated extraction as a draft.
 * Extraction failure never blocks the upload — the prescription simply needs manual reading.
 */
export async function uploadPrescription(
  actor: Actor | null,
  input: { familyMemberId: string; file: { name: string; type: string; size: number; bytes: Buffer } },
) {
  assertRole(actor, ["CUSTOMER"]);
  const cfg = config();
  const member = await db.familyMember.findFirst({ where: { id: input.familyMemberId, customerId: actor.id } });
  if (!member) throw new DomainError("NOT_FOUND", "Patient profile not found.");
  await enforceRateLimit(db, `upload:${actor.id}`, UPLOADS_PER_HOUR, 3600, "Upload limit reached. Please try again later.");
  const mimeType = validatePrescriptionFile(input.file, cfg.UPLOAD_MAX_BYTES);

  const storageKey = newStorageKey();
  const stored = await storeEncrypted(storageKey, input.file.bytes);
  let prescriptionId: string;
  try {
    const rx = await db.$transaction(async (tx) => {
      const created = await tx.prescription.create({
        data: {
          customerId: actor.id,
          familyMemberId: member.id,
          storageKey,
          mimeType,
          sizeBytes: input.file.bytes.length,
          cipherSha256: stored.cipherSha256,
          keyId: stored.keyId,
        },
      });
      await audit(tx, {
        actor,
        action: "PRESCRIPTION_UPLOADED",
        entityType: "Prescription",
        entityId: created.id,
        metadata: { mimeType, sizeBytes: input.file.bytes.length },
      });
      return created;
    });
    prescriptionId = rx.id;
  } catch (e) {
    await removeStored(storageKey);
    throw e;
  }

  const provider = getExtractionProvider(cfg);
  const outcome = await runExtraction(
    provider,
    { bytes: input.file.bytes, mimeType },
    await loadCatalogueForMatching(db),
    {
      minFieldConfidence: cfg.EXTRACTION_MIN_FIELD_CONFIDENCE,
      minOverallConfidence: cfg.EXTRACTION_MIN_OVERALL_CONFIDENCE,
      minMatchScore: cfg.EXTRACTION_MIN_MATCH_SCORE,
    },
    cfg.EXTRACTION_TIMEOUT_MS,
  );
  await db.$transaction(async (tx) => {
    await persistExtraction(tx, prescriptionId, outcome);
    await audit(tx, {
      actor: null,
      action: "PRESCRIPTION_EXTRACTION_RUN",
      entityType: "Prescription",
      entityId: prescriptionId,
      metadata: {
        provider: outcome.provider,
        external: provider.external,
        status: outcome.status,
        errorCode: outcome.errorCode,
        lines: outcome.lines.length,
        durationMs: outcome.durationMs,
      },
    });
  });

  return { prescriptionId, status: outcome.status, issues: outcome.issues };
}

/**
 * Who may see a prescription file: the customer who uploaded it, or a pharmacist whose store
 * scope covers an order that uses it. Store staff and operations never see prescription images.
 */
async function canViewPrescription(actor: Actor, rx: { id: string; customerId: string }) {
  if (actor.role === "CUSTOMER") return rx.customerId === actor.id;
  if (actor.role !== "PHARMACIST") return false;
  const orders = await db.order.findMany({
    where: { OR: [{ prescriptionId: rx.id }, { reviews: { some: { prescriptionId: rx.id } } }] },
    select: { storeId: true },
  });
  return orders.some((o) => canAccessStore(actor, o.storeId));
}

/** Decrypts a prescription for an authorised viewer and records the access. */
export async function readPrescriptionFile(actor: Actor | null, prescriptionId: string) {
  assertRole(actor, ["CUSTOMER", "PHARMACIST", "STORE_STAFF", "OPS_ADMIN"]);
  const rx = await db.prescription.findUnique({ where: { id: prescriptionId } });
  if (!rx || !(await canViewPrescription(actor, rx))) {
    await audit(db, {
      actor,
      action: "ACCESS_DENIED",
      entityType: "Prescription",
      entityId: prescriptionId,
      metadata: { resource: "prescription_file" },
    });
    throw new DomainError("NOT_FOUND", "Prescription not found.");
  }
  const bytes = await readDecrypted(rx.storageKey);
  await audit(db, { actor, action: "PRESCRIPTION_FILE_VIEWED", entityType: "Prescription", entityId: rx.id });
  return { bytes, mimeType: rx.mimeType };
}
