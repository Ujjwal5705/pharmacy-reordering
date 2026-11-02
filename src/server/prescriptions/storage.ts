import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../env";
import { decryptBlob, encryptBlob, parseKey, sha256Hex } from "./crypto";

const STORAGE_KEY_RE = /^[a-f0-9]{32}\.enc$/;

function storageRoot() {
  return path.resolve(process.cwd(), config().PRIVATE_STORAGE_DIR);
}

/** Resolves a storage key to a path, refusing anything that is not a generated key (no traversal). */
function resolveKey(storageKey: string) {
  if (!STORAGE_KEY_RE.test(storageKey)) throw new Error("Invalid storage key");
  const root = storageRoot();
  const full = path.resolve(root, storageKey);
  if (path.dirname(full) !== root) throw new Error("Invalid storage path");
  return full;
}

export function newStorageKey() {
  return `${randomBytes(16).toString("hex")}.enc`;
}

/** Encrypts and writes a prescription file outside any public directory. */
export async function storeEncrypted(storageKey: string, plaintext: Buffer) {
  const cfg = config();
  const key = parseKey(cfg.PRESCRIPTION_ENCRYPTION_KEY);
  const blob = encryptBlob(plaintext, key, storageKey);
  await mkdir(storageRoot(), { recursive: true, mode: 0o700 });
  await writeFile(resolveKey(storageKey), blob, { mode: 0o600, flag: "wx" });
  return { cipherSha256: sha256Hex(blob), keyId: cfg.PRESCRIPTION_ENCRYPTION_KEY_ID };
}

export async function readDecrypted(storageKey: string): Promise<Buffer> {
  const key = parseKey(config().PRESCRIPTION_ENCRYPTION_KEY);
  const blob = await readFile(resolveKey(storageKey));
  return decryptBlob(blob, key, storageKey);
}

export async function removeStored(storageKey: string) {
  await rm(resolveKey(storageKey), { force: true });
}
