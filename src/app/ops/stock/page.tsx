import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { requirePageRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { dateTime } from "@/lib/format";
import { ApplyImportButtons, StockUploadForm } from "./stock-forms";

export const metadata: Metadata = { title: "Stock import" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  await requirePageRole(["OPS_ADMIN"]);
  const { batch: batchId } = await searchParams;
  const [history, batch] = await Promise.all([
    db.stockImportBatch.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { uploadedBy: { select: { name: true } } } }),
    batchId ? db.stockImportBatch.findUnique({ where: { id: batchId }, include: { rows: { orderBy: { rowNumber: "asc" } } } }) : null,
  ]);
  const problems = batch?.rows.filter((r) => r.status !== "VALID") ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Daily stock import" description="Upload each store’s end-of-day stock snapshot. Preview first; nothing changes until you apply." />
      <Card>
        <CardHeader title="Upload CSV" description={<>Columns: <code className="rounded bg-canvas px-1">store_code,sku,quantity_on_hand</code> (packs). A sample is in <code className="rounded bg-canvas px-1">fixtures/stock/</code>.</>} />
        <div className="p-5">
          <StockUploadForm />
        </div>
      </Card>

      {batch ? (
        <Card>
          <CardHeader
            title={`Preview: ${batch.fileName}`}
            description={`${batch.totalRows} rows · ${batch.validRows} valid · ${batch.errorRows} with problems · ${batch.status.toLowerCase()}`}
            action={batch.status === "PREVIEW" ? <ApplyImportButtons batchId={batch.id} validRows={batch.validRows} /> : <Badge tone={batch.status === "APPLIED" ? "ok" : "neutral"}>{batch.status.toLowerCase()}</Badge>}
          />
          <div className="space-y-4 p-5">
            {problems.length ? (
              <Alert tone="warn" title={`${problems.length} row(s) will be skipped`}>
                Fix them in the source file and import again if needed. Valid rows can still be applied.
              </Alert>
            ) : (
              <Alert tone="ok" title="All rows are valid" />
            )}
            <div className="max-h-[420px] overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-canvas text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Row</th>
                    <th className="px-3 py-2 font-semibold">Store</th>
                    <th className="px-3 py-2 font-semibold">SKU</th>
                    <th className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...problems, ...batch.rows.filter((r) => r.status === "VALID")].map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-1.5 tabular-nums">{r.rowNumber}</td>
                      <td className="px-3 py-1.5">{r.storeCode || "—"}</td>
                      <td className="px-3 py-1.5">{r.sku || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.quantity ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        {r.status === "VALID" ? <Badge tone="ok">OK</Badge> : <Badge tone={r.status === "DUPLICATE" ? "warn" : "bad"}>{r.status.toLowerCase()}</Badge>}
                        {r.errorMessage ? <span className="ml-2 text-muted">{r.errorMessage}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Import history" />
        {history.length === 0 ? (
          <EmptyState title="No imports yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[15px]">
              <thead className="border-b border-line bg-canvas text-sm text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">File</th>
                  <th className="px-4 py-2.5 font-semibold">By</th>
                  <th className="px-4 py-2.5 font-semibold">When</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Rows (valid / problems)</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-2.5"><a href={`/ops/stock?batch=${h.id}`} className="font-medium hover:text-brand">{h.fileName}</a></td>
                    <td className="px-4 py-2.5">{h.uploadedBy.name}</td>
                    <td className="px-4 py-2.5">{dateTime(h.createdAt)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{h.totalRows} ({h.validRows} / {h.errorRows})</td>
                    <td className="px-4 py-2.5"><Badge tone={h.status === "APPLIED" ? "ok" : h.status === "PREVIEW" ? "info" : "neutral"}>{h.status.toLowerCase()}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
