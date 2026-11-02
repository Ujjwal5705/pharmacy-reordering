import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const num = (def: number) => z.preprocess(emptyToUndefined, z.coerce.number().default(def));
const bool = (def: boolean) =>
  z.preprocess(emptyToUndefined, z.enum(["true", "false"]).default(def ? "true" : "false")).transform(
    (v) => v === "true",
  );
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const schema = z.object({
  /** Defaults to "production" so a missing value can never switch on demo behaviour. */
  APP_ENV: z.preprocess(emptyToUndefined, z.enum(["demo", "test", "production"]).default("production")),
  AUTH_DEMO_OTP: z.preprocess(emptyToUndefined, z.string().regex(/^\d{6}$/).optional()),
  SESSION_TTL_HOURS: num(12).pipe(z.number().int().min(1).max(72)),
  PRESCRIPTION_ENCRYPTION_KEY: optionalString,
  PRESCRIPTION_ENCRYPTION_KEY_ID: z.preprocess(emptyToUndefined, z.string().default("local-1")),
  PRIVATE_STORAGE_DIR: z.preprocess(emptyToUndefined, z.string().default("./storage/private")),
  UPLOAD_MAX_BYTES: num(8 * 1024 * 1024).pipe(z.number().int().positive().max(20 * 1024 * 1024)),
  EXTRACTION_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(["local-ocr", "anthropic", "fixture", "none"]).default("local-ocr"),
  ),
  EXTRACTION_TIMEOUT_MS: num(25_000).pipe(z.number().int().min(1_000).max(120_000)),
  EXTRACTION_MIN_FIELD_CONFIDENCE: num(0.8).pipe(z.number().min(0).max(1)),
  EXTRACTION_MIN_OVERALL_CONFIDENCE: num(0.75).pipe(z.number().min(0).max(1)),
  EXTRACTION_MIN_MATCH_SCORE: num(0.85).pipe(z.number().min(0).max(1)),
  ALLOW_EXTERNAL_PRESCRIPTION_PROCESSING: bool(false),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString,
  REFILL_REMIND_DAYS_BEFORE: num(5).pipe(z.number().int().min(0).max(30)),
});

export type AppConfig = z.infer<typeof schema> & {
  demoOtpEnabled: boolean;
  isProductionLike: boolean;
};

let cached: AppConfig | null = null;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid configuration for: ${keys}`);
  }
  const cfg = parsed.data;
  if (cfg.APP_ENV === "production" && cfg.AUTH_DEMO_OTP) {
    // Fail loudly rather than silently accept a predictable OTP in production.
    throw new Error("AUTH_DEMO_OTP must not be set when APP_ENV=production.");
  }
  return {
    ...cfg,
    demoOtpEnabled: cfg.APP_ENV !== "production" && Boolean(cfg.AUTH_DEMO_OTP),
    isProductionLike: cfg.APP_ENV === "production",
  };
}

export function config(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Tests only: re-read process.env after mutating it. */
export function resetConfigCache() {
  cached = null;
}
