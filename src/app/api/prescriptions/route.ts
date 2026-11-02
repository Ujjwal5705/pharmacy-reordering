import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { config } from "@/server/env";
import { DomainError } from "@/server/errors";
import { errorResponse, isSameOrigin } from "@/server/http";
import { uploadPrescription } from "@/server/services/prescriptions";

export const runtime = "nodejs";
// Extraction (local OCR) can take a few seconds.
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) throw new DomainError("FORBIDDEN", "Cross-site request blocked.");
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > config().UPLOAD_MAX_BYTES + 64 * 1024) {
      throw new DomainError("VALIDATION", "The file is too large.");
    }
    const form = await req.formData();
    const file = form.get("file");
    const familyMemberId = String(form.get("familyMemberId") ?? "");
    if (!(file instanceof File)) throw new DomainError("VALIDATION", "Choose a photo or PDF of the prescription.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await uploadPrescription(await getActor(), {
      familyMemberId,
      file: { name: file.name, type: file.type, size: file.size, bytes },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse("api.prescriptions.upload", e);
  }
}
