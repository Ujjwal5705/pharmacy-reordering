import { execSync } from "node:child_process";
import { e2eEnv } from "../../playwright.config";

/** Migrates and seeds the test database with the synthetic demo dataset before the browser run. */
export default function globalSetup() {
  const env = { ...process.env, ...e2eEnv } as NodeJS.ProcessEnv;
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "inherit" });
}
