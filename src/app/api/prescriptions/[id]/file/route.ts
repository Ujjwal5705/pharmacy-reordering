import { getActor } from "@/server/auth/session";
import { errorResponse } from "@/server/http";
import { readPrescriptionFile } from "@/server/services/prescriptions";

export const runtime = "nodejs";

/** Streams a decrypted prescription to an authorised viewer. Every successful read is audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { bytes, mimeType } = await readPrescriptionFile(await getActor(), id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="prescription.${mimeType === "application/pdf" ? "pdf" : mimeType === "image/png" ? "png" : "jpg"}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; plugin-types application/pdf",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    return errorResponse("api.prescriptions.file", e);
  }
}
