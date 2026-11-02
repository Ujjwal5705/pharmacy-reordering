import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Pill } from "lucide-react";
import { getActor, homeFor } from "@/server/auth/session";
import { config } from "@/server/env";
import { getT } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const DEMO_ACCOUNTS = [
  { phone: "5550000001", label: "Debasish Ghosh — customer, orders for his mother" },
  { phone: "5550000002", label: "Rina Sen — customer" },
  { phone: "5550000003", label: "Arif Mondal — customer (re-upload requested)" },
  { phone: "5550000004", label: "Priya Das — customer (H1 demo prescription)" },
  { phone: "5550000101", label: "Ananya Roy — pharmacist, all stores" },
  { phone: "5550000102", label: "Sourav Dutta — pharmacist, Salt Lake only" },
  { phone: "5550000201", label: "Salt Lake store desk — store staff" },
  { phone: "5550000202", label: "Behala store desk — store staff" },
  { phone: "5550000301", label: "Central operations desk" },
];

export default async function LoginPage() {
  const actor = await getActor();
  if (actor) redirect(homeFor(actor.role));
  const t = await getT();
  const cfg = config();
  return (
    <main className="mx-auto flex min-h-[80dvh] max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <span className="mx-auto mb-4 inline-flex rounded-2xl bg-brand p-3 text-white">
          <Pill aria-hidden className="size-7" />
        </span>
        <h1 className="text-3xl font-bold tracking-tight">{t("app.name")}</h1>
        <p className="mt-2 text-lg text-muted">{t("app.tagline")}</p>
      </div>
      <LoginForm demoOtp={cfg.demoOtpEnabled ? cfg.AUTH_DEMO_OTP! : null} demoAccounts={cfg.demoOtpEnabled ? DEMO_ACCOUNTS : []} />
      <p className="mt-8 text-center text-sm text-muted">
        This service helps you order medicines a doctor has prescribed. It does not give medical advice. For medical questions, speak to your doctor or pharmacist.
      </p>
    </main>
  );
}
