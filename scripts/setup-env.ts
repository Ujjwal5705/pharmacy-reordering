/**
 * Creates a local .env from .env.example and fills in values that must be unique per machine.
 * Never overwrites an existing .env. Generated values stay on this machine (.env is git-ignored).
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const target = path.join(root, ".env");

if (existsSync(target)) {
  console.log(".env already exists — leaving it untouched.");
  process.exit(0);
}

let content = readFileSync(path.join(root, ".env.example"), "utf8");
const key = randomBytes(32).toString("base64");
content = content.replace(/^PRESCRIPTION_ENCRYPTION_KEY=""$/m, `PRESCRIPTION_ENCRYPTION_KEY="${key}"`);
// Synthetic demo OTP, only honoured while APP_ENV=demo.
content = content.replace(/^AUTH_DEMO_OTP=""$/m, `AUTH_DEMO_OTP="246810"`);

writeFileSync(target, content, { mode: 0o600 });
console.log("Created .env with a freshly generated local prescription encryption key.");
