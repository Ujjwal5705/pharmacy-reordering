"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { requestOtpAction, verifyOtpAction } from "@/app/actions/auth";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

export function LoginForm({ demoOtp, demoAccounts }: { demoOtp: string | null; demoAccounts: { phone: string; label: string }[] }) {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function sendCode(e?: React.FormEvent, p = phone) {
    e?.preventDefault();
    setError(null);
    start(async () => {
      const r = await requestOtpAction(p);
      if (!r.ok) return setError(r.error.message);
      setPhone(r.data.phone);
      setStep("code");
    });
  }

  function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await verifyOtpAction(phone, code);
      if (!r.ok) return setError(r.error.message);
      router.replace(r.data.redirectTo);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        {step === "phone" ? (
          <form onSubmit={sendCode} className="space-y-4" noValidate>
            <Field label="Mobile number" htmlFor="phone" hint="We will send a one-time code to this number." error={error}>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-xl border border-r-0 border-line-strong bg-canvas px-3 text-base text-muted">+91</span>
                <Input
                  id="phone"
                  name="phone"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="10-digit number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-invalid={Boolean(error)}
                  className="rounded-l-none text-lg"
                  required
                />
              </div>
            </Field>
            <Button type="submit" size="lg" className="w-full" disabled={pending || phone.replace(/\D/g, "").length < 10}>
              {pending ? <Loader2 aria-hidden className="size-5 animate-spin" /> : null}
              Send code
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4" noValidate>
            <p className="text-[15px] text-ink-soft">
              Enter the 6-digit code sent to <strong>+91 {phone}</strong>.{" "}
              <button type="button" className="font-semibold text-brand underline underline-offset-4" onClick={() => { setStep("phone"); setCode(""); setError(null); }}>
                Change number
              </button>
            </p>
            {demoOtp ? (
              <Alert tone="warn" title="Demo mode">
                Use the demo code <strong className="font-mono">{demoOtp}</strong>. It only works in this local demo and is refused in production.
              </Alert>
            ) : null}
            <Field label="One-time code" htmlFor="code" error={error}>
              <Input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                aria-invalid={Boolean(error)}
                className="text-center font-mono text-2xl tracking-[0.4em]"
                autoFocus
              />
            </Field>
            <Button type="submit" size="lg" className="w-full" disabled={pending || code.length !== 6}>
              {pending ? <Loader2 aria-hidden className="size-5 animate-spin" /> : null}
              Sign in
            </Button>
            <button type="button" className="w-full text-sm font-medium text-muted underline underline-offset-4" onClick={() => sendCode()} disabled={pending}>
              Send a new code
            </button>
          </form>
        )}
      </Card>

      {demoAccounts.length && step === "phone" ? (
        <Card className="p-5">
          <h2 className="font-semibold">Demo accounts (fictional)</h2>
          <p className="mt-0.5 text-sm text-muted">Choose one to fill in the number, then send the code.</p>
          <ul className="mt-3 divide-y divide-line">
            {demoAccounts.map((a) => (
              <li key={a.phone}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-[15px] hover:text-brand"
                  onClick={() => { setPhone(a.phone); setError(null); }}
                >
                  <span>{a.label}</span>
                  <span className="shrink-0 font-mono text-sm text-muted">{a.phone}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
