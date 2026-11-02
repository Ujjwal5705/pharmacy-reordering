"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requestOtp, verifyOtp } from "@/server/auth/otp";
import { clearSession, clientKey, getActor, homeFor, setSessionCookie } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { runAction } from "@/server/errors";
import { isLocale } from "@/lib/i18n/dictionaries";
import { LANG_COOKIE } from "@/lib/i18n/server";
import { PATIENT_COOKIE } from "@/server/customer-context";

export async function requestOtpAction(phone: string) {
  return runAction("auth.request", async () => {
    const r = await requestOtp(phone, await clientKey());
    return { phone: r.phone };
  });
}

export async function verifyOtpAction(phone: string, code: string) {
  return runAction("auth.verify", async () => {
    const { token, ttlHours, user } = await verifyOtp(phone, code, await clientKey());
    await setSessionCookie(token, ttlHours);
    (await cookies()).delete(PATIENT_COOKIE);
    return { redirectTo: homeFor(user.role) };
  });
}

export async function signOutAction() {
  const actor = await getActor();
  if (actor) await audit(db, { actor, action: "AUTH_LOGOUT", entityType: "User", entityId: actor.id });
  await clearSession();
  (await cookies()).delete(PATIENT_COOKIE);
  redirect("/login");
}

export async function setLanguageAction(formData: FormData) {
  const lang = String(formData.get("lang") ?? "");
  if (isLocale(lang)) {
    (await cookies()).set(LANG_COOKIE, lang, { path: "/", sameSite: "lax", maxAge: 365 * 24 * 3600 });
    revalidatePath("/", "layout");
  }
}
