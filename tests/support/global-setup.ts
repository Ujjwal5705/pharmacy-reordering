import { execSync } from "node:child_process";
import { ensureTestDatabase } from "./ensure-test-db";
import { TEST_DATABASE_URL } from "./test-db-url";

/** Creates (if needed) and migrates the dedicated test database — never the demo database. */
export default async function setup() {
  try {
    await ensureTestDatabase(TEST_DATABASE_URL);
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: "pipe" });
  } catch (e) {
    const out = (e as { stderr?: Buffer }).stderr?.toString() ?? (e instanceof Error ? e.message : "");
    throw new Error(`Could not prepare the test database. Is Postgres running (npm run db:up)?\n${out.slice(0, 500)}`);
  }
}
