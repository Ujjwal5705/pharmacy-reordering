import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { audit } from "../audit";
import { db } from "../db";
import { config } from "../env";
import { DomainError } from "../errors";
import { enforceRateLimit, hashKey } from "../rate-limit";
import { notify } from "../services/notifications";

export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s\-()]/g, "").replace(/^\+?91/, ""))
  .pipe(z.string().regex(/^\d{10}$/, "Enter a 10-digit mobile number."));
export const otpSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.");

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

function hashCode(challengeId: string, code: string) {
  return createHash("sha256").update(`${challengeId}:${code}`).digest("hex");
}

/**
 * Issues a one-time code. In demo mode (APP_ENV=demo, never production) the configured demo code
 * is used; otherwise a random code is generated and handed to the (mock) SMS adapter.
 * The response is identical whether or not the number is registered.
 */
export async function requestOtp(rawPhone: string, clientKey: string) {
  const phone = phoneSchema.parse(rawPhone);
  await enforceRateLimit(db, `otp-req:phone:${hashKey(phone)}`, 5, 15 * 60);
  await enforceRateLimit(db, `otp-req:client:${hashKey(clientKey)}`, 30, 60 * 60);

  const cfg = config();
  const code = cfg.demoOtpEnabled ? cfg.AUTH_DEMO_OTP! : String(randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge = await db.otpChallenge.create({
    data: { phone, codeHash: "pending", expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });
  await db.otpChallenge.update({ where: { id: challenge.id }, data: { codeHash: hashCode(challenge.id, code) } });

  const user = await db.user.findUnique({ where: { phone } });
  if (user) await notify(db, user.id, "OTP_SENT", { phoneLast4: phone.slice(-4) });
  await audit(db, { actor: null, action: "AUTH_OTP_REQUESTED", entityType: "Phone", entityId: hashKey(phone) });
  return { phone, demo: cfg.demoOtpEnabled };
}

/**
 * Verifies the latest live code for the number. Unknown numbers become new customer accounts;
 * staff accounts are only ever created by seeding/administration.
 */
export async function verifyOtp(rawPhone: string, rawCode: string, clientKey: string) {
  const phone = phoneSchema.parse(rawPhone);
  const code = otpSchema.parse(rawCode);
  await enforceRateLimit(db, `otp-verify:client:${hashKey(clientKey)}`, 50, 60 * 60);

  const challenge = await db.otpChallenge.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  const fail = async () => {
    await audit(db, { actor: null, action: "AUTH_LOGIN_FAILED", entityType: "Phone", entityId: hashKey(phone) });
    throw new DomainError("VALIDATION", "That code is not correct or has expired. Request a new code.");
  };
  if (!challenge || challenge.attempts >= MAX_VERIFY_ATTEMPTS) return fail();

  await db.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
  const expected = Buffer.from(challenge.codeHash, "hex");
  const actual = Buffer.from(hashCode(challenge.id, code), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return fail();

  const consumed = await db.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (consumed.count !== 1) return fail();

  let user = await db.user.findUnique({ where: { phone } });
  if (!user) {
    user = await db.user.create({
      data: {
        phone,
        name: `Customer ${phone.slice(-4)}`,
        role: "CUSTOMER",
        familyMembers: { create: { name: `Customer ${phone.slice(-4)}`, relation: "SELF" } },
      },
    });
  }
  if (!user.active) return fail();

  const token = randomBytes(32).toString("base64url");
  const ttlHours = config().SESSION_TTL_HOURS;
  await db.session.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlHours * 3600 * 1000) },
  });
  await audit(db, { actor: { id: user.id, role: user.role }, action: "AUTH_LOGIN_SUCCEEDED", entityType: "User", entityId: user.id });
  return { token, ttlHours, user };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function findSessionUser(token: string) {
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.active) return null;
  return session.user;
}

export async function revokeSession(token: string) {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
