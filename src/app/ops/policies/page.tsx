import type { Metadata } from "next";
import { CATEGORY_LABEL } from "@/components/status";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requirePageRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { resolvePolicy } from "@/server/domain/policy";
import { loadPolicyRules } from "@/server/services/catalogue";
import { dateOnly } from "@/lib/format";
import { PolicyForm } from "./policy-form";

export const metadata: Metadata = { title: "Medicine rules" };

export default async function PoliciesPage() {
  await requirePageRole(["OPS_ADMIN"]);
  const [policies, rules] = await Promise.all([
    db.medicinePolicy.findMany({ orderBy: [{ category: "asc" }, { version: "desc" }], include: { createdBy: { select: { name: true } } } }),
    loadPolicyRules(db),
  ]);
  const activeIds = new Set((["OTC", "SCHEDULE_H", "SCHEDULE_H1", "SCHEDULE_X", "NARCOTIC"] as const).map((c) => resolvePolicy(rules, c)?.id));
  const yes = (b: boolean) => (b ? <Badge tone="info">Yes</Badge> : <Badge>No</Badge>);

  return (
    <div className="space-y-5">
      <PageHeader title="Medicine category rules" description="Versioned and effective-dated, because online pharmacy rules are not final. Every change is audited." />
      <Alert tone="warn" title="Prototype configuration — not legal advice">
        These rules implement the brief’s statements only. Schedule X and narcotic items can never be enabled online, and Schedule H/H1 always need a prescription and pharmacist approval (enforced in code and in the database).
      </Alert>
      <Card className="overflow-hidden">
        <CardHeader title="Versions" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[15px]">
            <thead className="border-b border-line bg-canvas text-sm text-muted">
              <tr>
                {["Category", "Version", "Effective", "Sold online", "Prescription", "Pharmacist", "H1 register", "Notes"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {policies.map((p) => (
                <tr key={p.id} className={activeIds.has(p.id) ? "bg-brand-soft/30" : undefined}>
                  <td className="px-4 py-2.5 font-medium">
                    {CATEGORY_LABEL[p.category]} {activeIds.has(p.id) ? <Badge tone="ok">Active</Badge> : null}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">v{p.version}</td>
                  <td className="px-4 py-2.5">{dateOnly(p.effectiveFrom)} → {p.effectiveTo ? dateOnly(p.effectiveTo) : "open"}</td>
                  <td className="px-4 py-2.5">{p.onlineOrderable ? <Badge tone="ok">Yes</Badge> : <Badge tone="bad">No</Badge>}</td>
                  <td className="px-4 py-2.5">{yes(p.prescriptionRequired)}</td>
                  <td className="px-4 py-2.5">{yes(p.pharmacistApprovalRequired)}</td>
                  <td className="px-4 py-2.5">{yes(p.h1RegisterRequired)}</td>
                  <td className="max-w-xs px-4 py-2.5 text-sm text-muted">{p.description}{p.createdBy ? ` — ${p.createdBy.name}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHeader title="Add a new version" description="Takes effect from the chosen date. Earlier versions are kept for history." />
        <div className="p-5">
          <PolicyForm />
        </div>
      </Card>
    </div>
  );
}
