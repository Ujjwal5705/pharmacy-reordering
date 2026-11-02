"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, FileWarning, Loader2, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { submitReviewAction } from "@/app/actions/staff";
import { ConfidenceBadge } from "@/components/status";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";

export type ReviewItem = {
  id: string;
  name: string;
  detail: string;
  unitsPerPack: number;
  quantity: number;
  category: string;
  status: string;
  h1: boolean;
  rx: boolean;
  pricePaise: number;
  match: {
    lineNo: number;
    text: string;
    dosageText: string | null;
    unitsPerDay: number | null;
    durationDays: number | null;
    quantityUnits: number | null;
    quantityDerived: boolean;
    confidence: number;
    dosageConfidence: number;
  } | null;
  alternatives: { id: string; label: string; available: number | null }[];
};

type Decision = "" | "APPROVE" | "REJECT" | "PROPOSE_SUBSTITUTE";
type ItemState = {
  decision: Decision;
  approvedQuantity: string;
  unitsPerDay: string;
  dosageInstruction: string;
  reason: string;
  substituteProductId: string;
  h1: { patientName: string; patientAddress: string; prescriberName: string; prescriberAddress: string; prescriberRegNo: string };
};
type Header = { patientName: string; prescriberName: string; prescriberRegNo: string; prescriptionDate: string };

export function ReviewForm(props: {
  orderId: string;
  hasPrescription: boolean;
  items: ReviewItem[];
  otherItems: ReviewItem[];
  header: Header;
  headerConfidence: Record<keyof Header, number | null>;
  h1Defaults: { patientName: string; patientAddress: string; prescriberAddress: string };
  threshold: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [header, setHeader] = useState<Header>(props.header);
  const [mode, setMode] = useState<"decide" | "reupload" | "reject">("decide");
  const [orderReason, setOrderReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [state, setState] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(
      props.items.map((i) => [
        i.id,
        {
          decision: "",
          approvedQuantity: String(i.quantity),
          unitsPerDay: i.match?.unitsPerDay ? String(i.match.unitsPerDay) : "",
          dosageInstruction: i.match?.dosageText ?? "",
          reason: "",
          substituteProductId: "",
          h1: { patientName: props.h1Defaults.patientName, patientAddress: props.h1Defaults.patientAddress, prescriberName: props.header.prescriberName, prescriberAddress: props.h1Defaults.prescriberAddress, prescriberRegNo: props.header.prescriberRegNo },
        },
      ]),
    ),
  );
  const update = (id: string, patch: Partial<ItemState>) => setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const allDecided = props.items.every((i) => state[i.id].decision !== "");
  const counts = useMemo(() => {
    const v = Object.values(state);
    return { approve: v.filter((s) => s.decision === "APPROVE").length, reject: v.filter((s) => s.decision === "REJECT").length, sub: v.filter((s) => s.decision === "PROPOSE_SUBSTITUTE").length };
  }, [state]);

  function submit() {
    setErrors([]);
    const input =
      mode === "decide"
        ? {
            outcome: "DECIDE" as const,
            header: {
              patientName: header.patientName || undefined,
              prescriberName: header.prescriberName || undefined,
              prescriberRegNo: header.prescriberRegNo || undefined,
              prescriptionDate: header.prescriptionDate || undefined,
            },
            items: props.items.map((i) => {
              const s = state[i.id];
              return {
                orderItemId: i.id,
                decision: s.decision as Exclude<Decision, "">,
                approvedQuantity: s.decision === "REJECT" ? undefined : Number(s.approvedQuantity),
                unitsPerDay: s.decision !== "REJECT" && s.unitsPerDay ? Number(s.unitsPerDay) : undefined,
                dosageInstruction: s.decision !== "REJECT" ? s.dosageInstruction || undefined : undefined,
                reason: s.decision === "REJECT" ? s.reason : undefined,
                substituteProductId: s.decision === "PROPOSE_SUBSTITUTE" ? s.substituteProductId : undefined,
                h1: i.h1 && s.decision !== "REJECT" ? { ...s.h1, prescriberRegNo: s.h1.prescriberRegNo || undefined } : undefined,
              };
            }),
          }
        : { outcome: mode === "reupload" ? ("REQUEST_REUPLOAD" as const) : ("REJECT_ORDER" as const), reason: orderReason };
    start(async () => {
      const r = await submitReviewAction(props.orderId, input);
      if (!r.ok) {
        setErrors([r.error.message, ...r.error.details]);
        toast.error(r.error.message);
        return;
      }
      toast.success(r.message ?? "Saved");
      router.push("/pharmacist");
    });
  }

  const conf = (k: keyof Header) => (props.headerConfidence[k] !== null ? <ConfidenceBadge value={props.headerConfidence[k]} threshold={props.threshold} /> : <Badge tone="neutral">Not in draft</Badge>);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="1. Verify the prescription" description="Pre-filled from the automated draft. Check each value against the image and correct it." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {(
            [
              ["patientName", "Patient name on prescription", "text"],
              ["prescriberName", "Prescriber (doctor)", "text"],
              ["prescriberRegNo", "Prescriber registration no.", "text"],
              ["prescriptionDate", "Prescription date", "date"],
            ] as const
          ).map(([k, label, type]) => (
            <Field key={k} htmlFor={`h-${k}`} label={<span className="inline-flex flex-wrap items-center gap-2">{label} {conf(k)}</span>}>
              <Input id={`h-${k}`} type={type} value={header[k]} max={type === "date" ? new Date().toISOString().slice(0, 10) : undefined} onChange={(e) => setHeader({ ...header, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="2. Decide each item" description="Every prescription item needs your decision. Nothing here was approved automatically." />
        <ul className="divide-y divide-line">
          {props.items.map((i) => {
            const s = state[i.id];
            const suggestedPacks = i.match?.quantityUnits ? Math.ceil(i.match.quantityUnits / i.unitsPerPack) : null;
            return (
              <li key={i.id} className="space-y-4 p-5" data-testid="review-item">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">
                      {i.name} <span className="font-normal text-muted">× {i.quantity} requested</span>
                    </p>
                    <p className="text-sm text-muted">
                      {i.detail} · {money(i.pricePaise)} · {i.category}
                    </p>
                  </div>
                  {i.h1 ? (
                    <Badge tone="warn">
                      <FileWarning aria-hidden className="size-3.5" /> H1 register required
                    </Badge>
                  ) : null}
                </div>

                {i.match ? (
                  <div className="rounded-xl border border-ok/25 bg-ok-soft/50 p-3 text-[15px]">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      <CheckCircle2 aria-hidden className="size-4 text-ok" /> Draft line {i.match.lineNo}: {i.match.text} <ConfidenceBadge value={i.match.confidence} threshold={props.threshold} />
                    </p>
                    <p className="mt-0.5 text-ink-soft">
                      As written: {i.match.dosageText ?? "dosage not stated"}
                      {i.match.durationDays ? ` · ${i.match.durationDays} days` : ""}
                      {i.match.quantityUnits ? ` · ${i.match.quantityDerived ? "calculated" : "written"} ${i.match.quantityUnits} units ≈ ${suggestedPacks} pack(s)` : ""}
                    </p>
                    {suggestedPacks && i.quantity > suggestedPacks ? (
                      <p className="mt-1 font-medium text-warn">Requested {i.quantity} packs is more than the ~{suggestedPacks} this prescription covers.</p>
                    ) : null}
                  </div>
                ) : (
                  <Alert tone="warn" title="Not found in the automated draft">
                    Check the prescription image yourself. Reject the item if it is not prescribed.
                  </Alert>
                )}

                <div role="radiogroup" aria-label={`Decision for ${i.name}`} className="grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      ["APPROVE", "Approve", ShieldCheck, "border-ok bg-ok-soft text-ok"],
                      ["PROPOSE_SUBSTITUTE", "Generic alternative", RotateCcw, "border-warn bg-warn-soft text-warn"],
                      ["REJECT", "Reject item", XCircle, "border-bad bg-bad-soft text-bad"],
                    ] as const
                  ).map(([v, label, Icon, activeCls]) => {
                    const disabled = v === "PROPOSE_SUBSTITUTE" && i.alternatives.length === 0;
                    return (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={s.decision === v}
                        disabled={disabled}
                        title={disabled ? "No equivalent product in the catalogue" : undefined}
                        onClick={() => update(i.id, { decision: v })}
                        className={cn("inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 px-3 font-semibold disabled:cursor-not-allowed disabled:opacity-40", s.decision === v ? activeCls : "border-line text-ink-soft hover:border-line-strong")}
                      >
                        <Icon aria-hidden className="size-5" /> {label}
                      </button>
                    );
                  })}
                </div>

                {s.decision === "APPROVE" || s.decision === "PROPOSE_SUBSTITUTE" ? (
                  <div className="grid gap-4 sm:grid-cols-3">
                    {s.decision === "PROPOSE_SUBSTITUTE" ? (
                      <Field label="Equivalent product" htmlFor={`sub-${i.id}`} hint="Customer must consent before it is supplied." className="sm:col-span-3">
                        <Select id={`sub-${i.id}`} value={s.substituteProductId} onChange={(e) => update(i.id, { substituteProductId: e.target.value })}>
                          <option value="">Choose an equivalent</option>
                          {i.alternatives.map((a) => (
                            <option key={a.id} value={a.id} disabled={a.available !== null && a.available < Number(s.approvedQuantity)}>
                              {a.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}
                    <Field label="Approved packs" htmlFor={`q-${i.id}`} hint={`Up to ${i.quantity} requested.`}>
                      <Input id={`q-${i.id}`} type="number" min={1} max={i.quantity} value={s.approvedQuantity} onChange={(e) => update(i.id, { approvedQuantity: e.target.value })} />
                    </Field>
                    <Field label="Units per day (for refills)" htmlFor={`u-${i.id}`} hint="Only as written. Leave blank if not stated.">
                      <Input id={`u-${i.id}`} type="number" min={0.25} max={24} step={0.25} value={s.unitsPerDay} onChange={(e) => update(i.id, { unitsPerDay: e.target.value })} />
                    </Field>
                    <Field label="Dosage as written" htmlFor={`d-${i.id}`}>
                      <Input id={`d-${i.id}`} value={s.dosageInstruction} maxLength={200} onChange={(e) => update(i.id, { dosageInstruction: e.target.value })} />
                    </Field>
                    {i.h1 ? (
                      <fieldset className="grid gap-3 rounded-xl border border-warn/40 bg-warn-soft/30 p-4 sm:col-span-3 sm:grid-cols-2">
                        <legend className="px-1 text-sm font-semibold text-warn">Schedule H1 register entry</legend>
                        {(
                          [
                            ["patientName", "Patient name"],
                            ["patientAddress", "Patient address"],
                            ["prescriberName", "Prescriber name"],
                            ["prescriberAddress", "Prescriber address"],
                            ["prescriberRegNo", "Prescriber reg. no. (optional)"],
                          ] as const
                        ).map(([k, label]) => (
                          <Field key={k} label={label} htmlFor={`h1-${k}-${i.id}`}>
                            <Input id={`h1-${k}-${i.id}`} value={s.h1[k]} maxLength={200} onChange={(e) => update(i.id, { h1: { ...s.h1, [k]: e.target.value } })} />
                          </Field>
                        ))}
                        <p className="text-sm text-muted sm:col-span-2">Drug, quantity supplied and prescription date are added from this review automatically.</p>
                      </fieldset>
                    ) : null}
                  </div>
                ) : null}

                {s.decision === "REJECT" ? (
                  <Field label="Reason shown to the customer" htmlFor={`r-${i.id}`} error={s.reason && s.reason.trim().length < 5 ? "At least 5 characters." : null}>
                    <Textarea id={`r-${i.id}`} value={s.reason} maxLength={300} placeholder="For example: this medicine is not on the prescription." onChange={(e) => update(i.id, { reason: e.target.value })} />
                  </Field>
                ) : null}
              </li>
            );
          })}
        </ul>
        {props.otherItems.length ? (
          <div className="border-t border-line px-5 py-3 text-sm text-muted">
            Also on this order (no pharmacist decision needed): {props.otherItems.map((i) => `${i.name} × ${i.quantity}`).join(", ")}
          </div>
        ) : null}
      </Card>

      <Card className="border-brand/30">
        <CardHeader title="3. Submit" />
        <div className="space-y-4 p-5">
          <div role="tablist" aria-label="Decision type" className="flex flex-wrap gap-2">
            {(
              [
                ["decide", "Item decisions"],
                ["reupload", "Request re-upload"],
                ["reject", "Reject whole order"],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={mode === v} onClick={() => setMode(v)} className={cn("min-h-10 rounded-lg border px-3 text-sm font-semibold", mode === v ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-ink-soft")}>
                {label}
              </button>
            ))}
          </div>

          {mode === "decide" ? (
            <>
              <p className="text-[15px] text-ink-soft">
                {allDecided ? (
                  <>
                    {counts.approve} approve · {counts.sub} generic alternative (needs customer consent) · {counts.reject} reject.{" "}
                    {counts.sub ? "The order will wait for the customer’s consent." : counts.approve ? "The store can start packing once you submit." : "All items rejected — the order will be rejected."}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 text-warn">
                    <CircleAlert aria-hidden className="size-4" /> Choose a decision for every item.
                  </span>
                )}
              </p>
              <Button size="lg" onClick={submit} disabled={pending || !allDecided || !props.hasPrescription} data-testid="submit-review">
                {pending ? <Loader2 aria-hidden className="size-5 animate-spin" /> : <ShieldCheck aria-hidden className="size-5" />}
                Record decisions
              </Button>
            </>
          ) : (
            <>
              <Field
                label={mode === "reupload" ? "What should the customer fix?" : "Why is the order rejected?"}
                htmlFor="order-reason"
                hint="Shown to the customer. Do not include medical advice."
              >
                <Textarea id="order-reason" value={orderReason} maxLength={300} onChange={(e) => setOrderReason(e.target.value)} placeholder={mode === "reupload" ? "For example: the strength is not legible — please upload a clear photo of the whole page." : "For example: the prescription is for a different patient."} />
              </Field>
              <Button size="lg" variant={mode === "reject" ? "danger" : "primary"} onClick={submit} disabled={pending || orderReason.trim().length < 5}>
                {pending ? <Loader2 aria-hidden className="size-5 animate-spin" /> : null}
                {mode === "reupload" ? "Put on hold and request re-upload" : "Reject order and refund (test)"}
              </Button>
            </>
          )}
          {errors.length ? (
            <Alert tone="bad" title={errors[0]}>
              {errors.length > 1 ? <ul className="list-disc pl-5">{errors.slice(1).map((e) => <li key={e}>{e}</li>)}</ul> : null}
            </Alert>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
