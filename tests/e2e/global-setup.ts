import { execSync } from "node:child_process";
import { e2eEnv } from "../../playwright.config";
import { ensureTestDatabase } from "../support/ensure-test-db";

/** Creates/migrates the test database and seeds the synthetic demo dataset before the browser run. */
export default async function globalSetup() {
  await ensureTestDatabase(e2eEnv.DATABASE_URL);
  const env = { ...process.env, ...e2eEnv } as NodeJS.ProcessEnv;
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "inherit" });
}
