import { randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { loadConfig } from "@/server/env";
import { AnthropicVisionProvider } from "@/server/extraction/providers/anthropic";
import { getExtractionProvider } from "@/server/extraction/registry";
import { decryptBlob, encryptBlob, parseKey } from "@/server/prescriptions/crypto";
import { sniffMime, validatePrescriptionFile } from "@/server/prescriptions/file-validation";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(64)]);

describe("demo OTP can never be enabled in production", () => {
  it("throws when AUTH_DEMO_OTP is set with APP_ENV=production", () => {
    expect(() => loadConfig({ APP_ENV: "production", AUTH_DEMO_OTP: "123456" })).toThrow(/must not be set/);
  });
  it("defaults to production (demo off) when APP_ENV is missing", () => {
    expect(() => loadConfig({ AUTH_DEMO_OTP: "123456" })).toThrow(/must not be set/);
    expect(loadConfig({}).demoOtpEnabled).toBe(false);
  });
  it("enables demo OTP only in demo/test environments", () => {
    expect(loadConfig({ APP_ENV: "demo", AUTH_DEMO_OTP: "246810" }).demoOtpEnabled).toBe(true);
    expect(loadConfig({ APP_ENV: "demo" }).demoOtpEnabled).toBe(false);
  });
});

describe("external AI processing is opt-in", () => {
  const base = loadConfig({ APP_ENV: "test", EXTRACTION_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test-not-real" });
  it("does not send prescriptions out just because a key exists", async () => {
    const p = getExtractionProvider(base);
    expect(p.external).toBe(false);
    await expect(p.extract({ bytes: PNG, mimeType: "image/png" }, new AbortController().signal)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
  it("uses the Claude adapter only with explicit consent flag + key", () => {
    const p = getExtractionProvider({ ...base, ALLOW_EXTERNAL_PRESCRIPTION_PROCESSING: true });
    expect(p).toBeInstanceOf(AnthropicVisionProvider);
    expect(p.external).toBe(true);
  });
});

describe("Claude adapter failure handling (mocked client, no network)", () => {
  const fake = (impl: () => Promise<unknown>) =>
    ({ beta: { messages: { parse: impl } } }) as unknown as Anthropic;
  const run = (impl: () => Promise<unknown>) =>
    new AnthropicVisionProvider({ client: fake(impl) }).extract({ bytes: PNG, mimeType: "image/png" }, new AbortController().signal);

  it("returns the parsed structured output", async () => {
    const out = { pageConfidence: 0.9, fields: [], lines: [] };
    await expect(run(async () => ({ stop_reason: "end_turn", parsed_output: out }))).resolves.toEqual(out);
  });
  it("maps refusals and truncation to provider errors", async () => {
    await expect(run(async () => ({ stop_reason: "refusal", parsed_output: null }))).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    await expect(run(async () => ({ stop_reason: "max_tokens", parsed_output: null }))).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("maps missing structured output and JSON errors to INVALID_RESPONSE", async () => {
    await expect(run(async () => ({ stop_reason: "end_turn", parsed_output: null }))).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(run(async () => { throw new SyntaxError("Unexpected token"); })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("maps connection failures to PROVIDER_ERROR", async () => {
    await expect(run(async () => { throw new Anthropic.APIConnectionError({ message: "down" }); })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("requires an API key", () => {
    expect(() => new AnthropicVisionProvider({})).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("prescription encryption (AES-256-GCM)", () => {
  const key = randomBytes(32);
  it("round-trips and does not leave plaintext in the blob", () => {
    const blob = encryptBlob(PNG, key, "abc.enc");
    expect(blob.includes(PNG.subarray(0, 8))).toBe(false);
    expect(decryptBlob(blob, key, "abc.enc").equals(PNG)).toBe(true);
  });
  it("detects tampering, wrong key and a blob moved to another record", () => {
    const blob = encryptBlob(PNG, key, "abc.enc");
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptBlob(tampered, key, "abc.enc")).toThrow();
    expect(() => decryptBlob(blob, randomBytes(32), "abc.enc")).toThrow();
    expect(() => decryptBlob(blob, key, "other.enc")).toThrow();
  });
  it("requires a 32-byte key", () => {
    expect(() => parseKey(undefined)).toThrow(/missing encryption key/);
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("upload validation", () => {
  const max = 1024;
  it("sniffs real content types", () => {
    expect([sniffMime(PNG), sniffMime(JPEG), sniffMime(PDF), sniffMime(Buffer.from("GIF89a"))]).toEqual(["image/png", "image/jpeg", "application/pdf", null]);
  });
  it("accepts matching name, type and content", () => {
    expect(validatePrescriptionFile({ name: "rx.png", type: "image/png", size: PNG.length, bytes: PNG }, max)).toBe("image/png");
    expect(validatePrescriptionFile({ name: "rx.JPG", type: "", size: JPEG.length, bytes: JPEG }, max)).toBe("image/jpeg");
  });
  it("rejects disguised files, mismatched extensions, oversize and empty files", () => {
    const html = Buffer.from("<html><script>alert(1)</script>");
    expect(() => validatePrescriptionFile({ name: "rx.png", type: "image/png", size: html.length, bytes: html }, max)).toThrow(/Only JPEG, PNG or PDF/);
    expect(() => validatePrescriptionFile({ name: "rx.pdf", type: "application/pdf", size: PNG.length, bytes: PNG }, max)).toThrow(/extension/);
    expect(() => validatePrescriptionFile({ name: "rx.png", type: "application/pdf", size: PNG.length, bytes: PNG }, max)).toThrow(/type does not match/);
    expect(() => validatePrescriptionFile({ name: "rx.png", type: "image/png", size: 4096, bytes: PNG }, max)).toThrow(/too large/);
    expect(() => validatePrescriptionFile({ name: "rx.png", type: "image/png", size: 0, bytes: Buffer.alloc(0) }, max)).toThrow(/empty/);
  });
});

describe("error mapping", () => {
  it("turns schema failures into readable validation errors instead of a generic failure", async () => {
    const { runAction } = await import("@/server/errors");
    const { z } = await import("zod");
    const r = await runAction("t", async () => z.object({ a: z.string().min(5, "At least 5 characters.") }).parse({ a: "x" }));
    expect(r).toEqual({ ok: false, error: { code: "VALIDATION", message: "At least 5 characters.", details: [] } });
  });
});
