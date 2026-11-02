import { DomainError } from "../errors";

export const ALLOWED_PRESCRIPTION_TYPES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "application/pdf": [".pdf"],
} as const;
export type PrescriptionMime = keyof typeof ALLOWED_PRESCRIPTION_TYPES;

/** Identifies the real file type from its leading bytes, ignoring what the browser claimed. */
export function sniffMime(buf: Buffer): PrescriptionMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

/**
 * Validates size, extension, declared type and content signature. Returns the sniffed MIME type,
 * which is the only type the server trusts from here on.
 */
export function validatePrescriptionFile(
  file: { name: string; type: string; size: number; bytes: Buffer },
  maxBytes: number,
): PrescriptionMime {
  if (file.size === 0 || file.bytes.length === 0) throw new DomainError("VALIDATION", "The file is empty.");
  if (file.size > maxBytes || file.bytes.length > maxBytes) {
    throw new DomainError("VALIDATION", `The file is too large. Maximum size is ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
  const ext = (/\.[A-Za-z0-9]{1,5}$/.exec(file.name)?.[0] ?? "").toLowerCase();
  const sniffed = sniffMime(file.bytes);
  if (!sniffed) throw new DomainError("VALIDATION", "Only JPEG, PNG or PDF files are accepted.");
  if (!(ALLOWED_PRESCRIPTION_TYPES[sniffed] as readonly string[]).includes(ext)) {
    throw new DomainError("VALIDATION", "The file extension does not match its contents.");
  }
  // Some mobile browsers send an empty or generic type; anything else must agree with the content.
  if (file.type && file.type !== "application/octet-stream" && file.type !== sniffed) {
    throw new DomainError("VALIDATION", "The file type does not match its contents.");
  }
  return sniffed;
}
