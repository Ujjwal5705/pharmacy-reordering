import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DomainError } from "../errors";

const MAGIC = Buffer.from("RXE1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseKey(base64: string | undefined): Buffer {
  if (!base64) {
    throw new DomainError("CONFIG", "Prescription storage is not configured (missing encryption key).");
  }
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) {
    throw new DomainError("CONFIG", "Prescription encryption key must be 32 bytes (base64 encoded).");
  }
  return key;
}

/** AES-256-GCM via Node's crypto. Layout: "RXE1" | 12-byte IV | 16-byte auth tag | ciphertext. */
export function encryptBlob(plaintext: Buffer, key: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

/** Throws if the blob was tampered with, the key is wrong, or it was bound to a different record. */
export function decryptBlob(blob: Buffer, key: Buffer, aad: string): Buffer {
  if (blob.length < MAGIC.length + IV_BYTES + TAG_BYTES || !blob.subarray(0, 4).equals(MAGIC)) {
    throw new Error("Not an encrypted prescription blob");
  }
  const iv = blob.subarray(4, 4 + IV_BYTES);
  const tag = blob.subarray(4 + IV_BYTES, 4 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(4 + IV_BYTES + TAG_BYTES)), decipher.final()]);
}

export function sha256Hex(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}
