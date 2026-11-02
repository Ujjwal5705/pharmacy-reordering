"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, FileText, Loader2, Store } from "lucide-react";
import { submitOrderAction } from "@/app/actions/customer";
import { PrescriptionUploader } from "@/components/customer/prescription-uploader";
import { ExtractionDraft, PrescriptionPreview, type RunWithDetail } from "@/components/prescription";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import { dateTime, money } from "@/lib/format";

type Line = { productId: string; name: string; packLabel: string; quantity: number; linePaise: number; prescriptionRequired: boolean; h1: boolean; onPrescription: boolean | null };
type Rx = { id: string; uploadedAt: string; mimeType: string; extractionStatus: string | null; lastReview: string | null };

const EXTRACTION_LABEL: Record<string, { tone: "ok" | "warn" | "info"; text: string }> = {
  SUCCEEDED: { tone: "ok", text: "Read clearly" },
  LOW_CONFIDENCE: { tone: "warn", text: "Hard to read" },
  UNREADABLE: { tone: "warn", text: "Not readable" },
  FAILED: { tone: "info", text: "Manual reading" },
  UNSUPPORTED: { tone: "info", text: "Manual reading" },
};

export function CheckoutForm(props: {
  patient: { id: string; name: string };
  source: "CATALOGUE" | "REORDER" | "REFILL_REMINDER";
  lines: Line[];
  subtotal: number;
  needsPrescription: boolean;
  prescriptions: Rx[];
  selectedRx: { id: string; mimeType: string } | null;
  run: RunWithDetail | null;
  localities: { id: string; name: string; pincode: string }[];
  localityId: string | null;
  defaultAddress: string;
  routing: { store: { id: string; name: string; distanceKm: number } | null; unavailable: string[] } | null;
  labels: { submit: string; upload: string; testMode: string; rxRequired: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [address, setAddress] = useState(props.defaultAddress);
  const [payment, setPayment] = useState<"UPI_TEST" | "COD_TEST">("UPI_TEST");
  const [manualAck, setManualAck] = useState(false);
  const [noStockAck, setNoStockAck] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const unclear = props.run && ["LOW_CONFIDENCE", "UNREADABLE"].includes(props.run.status);
  const noStock = props.routing && !props.routing.store;
  const missingRx = props.needsPrescription && !props.selectedRx;
  const canSubmit = !missingRx && props.localityId && address.trim().length >= 6 && (!unclear || manualAck) && (!noStock || noStockAck);

  function submit() {
    setErrors([]);
    start(async () => {
      const r = await submitOrderAction({
        familyMemberId: props.patient.id,
        localityId: props.localityId ?? "",
        deliveryAddress: address,
        paymentMethod: payment,
        prescriptionId: props.selectedRx?.id ?? null,
        source: props.source,
      });
      if (!r.ok) {
        setErrors([r.error.message, ...r.error.details]);
        toast.error(r.error.message);
        return;
      }
      toast.success(`Order ${r.data.orderNumber} placed`);
      router.push(`/orders/${r.data.orderId}?placed=1`);
    });
  }

  return (
    <div className="space-y-5">
      {/* 1. Items */}
      <Card>
        <CardHeader title={`1. Items for ${props.patient.name}`} action={<Link href="/cart" className="text-sm font-semibold text-brand underline underline-offset-4">Edit cart</Link>} />
        <ul className="divide-y divide-line">
          {props.lines.map((l) => (
            <li key={l.productId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <p className="font-semibold">
                  {l.name} <span className="font-normal text-muted">× {l.quantity}</span>
                </p>
                <p className="text-sm text-muted">{l.packLabel}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {l.prescriptionRequired ? <Badge tone="info">{props.labels.rxRequired}</Badge> : <Badge>No prescription needed</Badge>}
                  {l.h1 ? <Badge tone="warn">Schedule H1 · register entry</Badge> : null}
                  {l.onPrescription === true ? (
                    <Badge tone="ok">
                      <CheckCircle2 aria-hidden className="size-3.5" /> On the prescription (draft)
                    </Badge>
                  ) : l.onPrescription === false ? (
                    <Badge tone="warn">
                      <CircleAlert aria-hidden className="size-3.5" /> Not found on the prescription
                    </Badge>
                  ) : null}
                </div>
              </div>
              <span className="font-semibold tabular-nums">{money(l.linePaise)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-line px-5 py-3 text-lg">
          <span className="font-semibold">Total</span>
          <span className="font-bold tabular-nums">{money(props.subtotal)}</span>
        </div>
      </Card>

      {/* 2. Prescription */}
      <Card>
        <CardHeader
          title="2. Prescription"
          description={props.needsPrescription ? "Required. A registered pharmacist checks it on every order before anything is packed." : "Not needed for these items."}
        />
        {props.needsPrescription ? (
          <div className="space-y-5 p-5">
            {props.prescriptions.length ? (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-ink-soft">Use a prescription on file for {props.patient.name}</legend>
                <div className="space-y-2">
                  {props.prescriptions.map((p) => {
                    const ex = p.extractionStatus ? EXTRACTION_LABEL[p.extractionStatus] : null;
                    const active = props.selectedRx?.id === p.id;
                    return (
                      <label
                        key={p.id}
                        className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5", active ? "border-brand bg-brand-soft/50" : "border-line hover:border-line-strong")}
                      >
                        <input type="radio" name="rx" className="size-5 accent-[var(--color-brand)]" checked={active} onChange={() => setParam("rx", p.id)} />
                        <FileText aria-hidden className="size-5 text-muted" />
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[15px]">
                            Uploaded {dateTime(p.uploadedAt)} {p.mimeType === "application/pdf" ? "(PDF)" : ""}
                          </span>
                          {p.lastReview === "APPROVED" ? <Badge tone="ok">Accepted before</Badge> : null}
                          {ex ? <Badge tone={ex.tone}>{ex.text}</Badge> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-soft">{props.prescriptions.length ? "Or upload a new one" : "Upload the prescription"}</p>
              <PrescriptionUploader
                familyMemberId={props.patient.id}
                label={props.labels.upload}
                onUploaded={(r) => {
                  if (r.status === "SUCCEEDED") toast.success("Prescription uploaded and read");
                  else toast.warning("Prescription uploaded", { description: r.issues[0] });
                  setManualAck(false);
                  setParam("rx", r.prescriptionId);
                }}
              />
            </div>
            {props.selectedRx ? (
              <div className="grid gap-4 md:grid-cols-[minmax(0,220px)_1fr]">
                <PrescriptionPreview id={props.selectedRx.id} mimeType={props.selectedRx.mimeType} alt="Your uploaded prescription" className="max-h-80 w-full rounded-xl border border-line bg-white object-contain" />
                <div className="space-y-3">
                  <ExtractionDraft run={props.run} />
                  {unclear ? (
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-warn/30 bg-warn-soft/50 p-3 text-[15px]">
                      <input type="checkbox" className="mt-1 size-5 accent-[var(--color-brand)]" checked={manualAck} onChange={(e) => setManualAck(e.target.checked)} />
                      <span>Send it anyway — I understand the pharmacist may ask me to upload a clearer photo, which can delay the order.</span>
                    </label>
                  ) : null}
                </div>
              </div>
            ) : (
              <Alert tone="info" title="Choose or upload a prescription to continue" />
            )}
          </div>
        ) : null}
      </Card>

      {/* 3. Delivery */}
      <Card>
        <CardHeader title="3. Delivery" description="Same-day delivery from the nearest store that has every item in stock." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Delivery area" htmlFor="area" hint="Stores are chosen by straight-line distance from this area (prototype).">
            <Select id="area" value={props.localityId ?? ""} onChange={(e) => setParam("area", e.target.value)}>
              <option value="" disabled>
                Choose your area
              </option>
              {props.localities.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.pincode})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Delivery address" htmlFor="address" error={address.trim().length > 0 && address.trim().length < 6 ? "Enter the full address." : null}>
            <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" maxLength={200} />
          </Field>
          <div className="sm:col-span-2">
            {!props.localityId ? (
              <Alert tone="info" title="Choose your delivery area to see which store will deliver" />
            ) : props.routing?.store ? (
              <Alert tone="ok" title={`Nearest store with everything in stock: ${props.routing.store.name}`}>
                About {props.routing.store.distanceKm.toFixed(1)} km away. Stock is reserved when you place the order.
              </Alert>
            ) : (
              <Alert tone="warn" title="No single store has all of these items right now">
                {props.routing?.unavailable.length ? <>Not enough stock anywhere for: {props.routing.unavailable.join(", ")}. </> : <>Each item is in stock somewhere, but not all at one store. </>}
                We never split an order between stores. You can reduce the quantity in the cart, or place the order and it will wait until a store is restocked — operations is alerted.
                <label className="mt-3 flex cursor-pointer items-start gap-3">
                  <input type="checkbox" className="mt-1 size-5 accent-[var(--color-brand)]" checked={noStockAck} onChange={(e) => setNoStockAck(e.target.checked)} />
                  <span className="text-ink">Place the order and wait for stock</span>
                </label>
              </Alert>
            )}
          </div>
        </div>
      </Card>

      {/* 4. Payment */}
      <Card>
        <CardHeader title="4. Payment" description={props.labels.testMode} action={<Badge tone="warn">Test mode</Badge>} />
        <fieldset className="grid gap-3 p-5 sm:grid-cols-2">
          <legend className="sr-only">Payment method</legend>
          {[
            { v: "UPI_TEST" as const, title: "UPI (test)", body: "Simulated instant payment. No UPI app opens and no money moves." },
            { v: "COD_TEST" as const, title: "Cash on delivery (test)", body: "Pay the delivery person. Recorded as test data only." },
          ].map((o) => (
            <label key={o.v} className={cn("flex cursor-pointer gap-3 rounded-xl border p-4", payment === o.v ? "border-brand bg-brand-soft/50" : "border-line")}>
              <input type="radio" name="payment" className="mt-1 size-5 accent-[var(--color-brand)]" checked={payment === o.v} onChange={() => setPayment(o.v)} />
              <span>
                <span className="block font-semibold">{o.title}</span>
                <span className="text-sm text-muted">{o.body}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Card>

      <Alert tone="info" title="Generic alternatives need your consent">
        If the pharmacist suggests an equivalent generic medicine, we will ask you first. Nothing is changed without your consent.
      </Alert>

      {errors.length ? (
        <Alert tone="bad" title={errors[0]}>
          {errors.length > 1 ? <ul className="list-disc pl-5">{errors.slice(1).map((e) => <li key={e}>{e}</li>)}</ul> : null}
        </Alert>
      ) : null}

      <div className="sticky bottom-20 z-10 rounded-2xl border border-line bg-surface/95 p-4 shadow-lg backdrop-blur md:bottom-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Total ({payment === "UPI_TEST" ? "UPI test" : "COD test"})</p>
            <p className="text-xl font-bold tabular-nums">{money(props.subtotal)}</p>
          </div>
          <Button size="lg" onClick={submit} disabled={!canSubmit || pending} data-testid="place-order">
            {pending ? <Loader2 aria-hidden className="size-5 animate-spin" /> : <Store aria-hidden className="size-5" />}
            {pending ? "Placing order…" : props.labels.submit}
          </Button>
        </div>
        {!canSubmit && !pending ? (
          <p className="mt-2 text-sm text-muted">
            {missingRx
              ? "Add the prescription to continue."
              : !props.localityId
                ? "Choose the delivery area."
                : address.trim().length < 6
                  ? "Enter the delivery address."
                  : unclear && !manualAck
                    ? "Re-upload a clearer photo, or confirm sending it for manual review."
                    : noStock && !noStockAck
                      ? "Confirm that the order can wait for stock, or adjust the cart."
                      : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
