"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { applyStockAction, discardStockAction, previewStockAction } from "@/app/actions/staff";
import { Alert, Button, Field, Input } from "@/components/ui";

export function StockUploadForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const r = await previewStockAction(data);
          if (!r.ok) return setError(r.error);
          router.push(`/ops/stock?batch=${r.data.batchId}`);
        });
      }}
    >
      <Field label="Stock CSV" htmlFor="stock-file" hint="Up to 2 MB, 20,000 rows.">
        <Input id="stock-file" name="file" type="file" accept=".csv,text/csv" required className="py-2.5" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Upload aria-hidden className="size-4" />}
        Validate and preview
      </Button>
      {error ? (
        <Alert tone="bad" title={error.message}>
          {error.details.length ? <ul className="list-disc pl-5">{error.details.map((d) => <li key={d}>{d}</li>)}</ul> : null}
        </Alert>
      ) : null}
    </form>
  );
}

export function ApplyImportButtons({ batchId, validRows }: { batchId: string; validRows: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        disabled={pending || validRows === 0}
        onClick={() =>
          start(async () => {
            const r = await applyStockAction(batchId);
            if (!r.ok) return void toast.error(r.error.message);
            toast.success(`Applied ${r.data.applied} row(s)`, {
              description: `${r.data.refused ? `${r.data.refused} refused (below reserved stock). ` : ""}${r.data.rerouted} waiting order(s) routed.`,
            });
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
        Apply {validRows} valid row(s)
      </Button>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await discardStockAction(batchId);
            if (!r.ok) return void toast.error(r.error.message);
            toast.success("Discarded");
            router.refresh();
          })
        }
      >
        Discard
      </Button>
    </div>
  );
}
