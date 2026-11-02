import { execSync } from "node:child_process";
import { TEST_DATABASE_URL } from "./test-db-url";

/** Applies migrations to the dedicated test database (never the demo database). */
export default function setup() {
  if (!/pharmacy_test/.test(TEST_DATABASE_URL)) {
    throw new Error("TEST_DATABASE_URL must point at a database named pharmacy_test.");
  }
  try {
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: "pipe" });
  } catch (e) {
    const out = (e as { stderr?: Buffer }).stderr?.toString() ?? "";
    throw new Error(`Could not migrate the test database. Is Postgres running (npm run db:up)?\n${out.slice(0, 500)}`);
  }
}
