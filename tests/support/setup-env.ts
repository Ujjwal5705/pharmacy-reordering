import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TEST_DATABASE_URL } from "./test-db-url";

// Runs before each test file's imports, so the Prisma client and config see test values only.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_ENV = "test";
process.env.AUTH_DEMO_OTP = "123456";
process.env.PRESCRIPTION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.PRESCRIPTION_ENCRYPTION_KEY_ID = "test-key";
process.env.PRIVATE_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), "rx-test-storage-"));
process.env.EXTRACTION_PROVIDER = "fixture";
process.env.EXTRACTION_TIMEOUT_MS = "5000";
process.env.REFILL_REMIND_DAYS_BEFORE = "5";
process.env.ANTHROPIC_API_KEY = "";
