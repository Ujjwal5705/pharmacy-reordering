import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// One key per run, shared by the seed step and the app server (workers inherit process.env).
process.env.E2E_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://pharmacy:pharmacy_local_dev@localhost:5433/pharmacy_test?schema=public";

export const e2eEnv = {
  DATABASE_URL: TEST_DATABASE_URL,
  APP_ENV: "demo",
  AUTH_DEMO_OTP: "246810",
  PRESCRIPTION_ENCRYPTION_KEY: process.env.E2E_ENCRYPTION_KEY,
  PRIVATE_STORAGE_DIR: "./storage/e2e",
  // Deterministic provider: no external AI and no OCR timing differences in CI.
  EXTRACTION_PROVIDER: "fixture",
  NEXT_DIST_DIR: ".next-e2e",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/login",
    timeout: 180_000,
    reuseExistingServer: false,
    env: e2eEnv as Record<string, string>,
  },
});
