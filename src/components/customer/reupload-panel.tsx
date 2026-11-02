"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { reuploadAction } from "@/app/actions/customer";
import { Alert, Button } from "@/components/ui";
import { PrescriptionUploader, type UploadResult } from "./prescription-uploader";

export function ReuploadPanel({ orderId, familyMemberId, label }: { orderId: string; familyMemberId: string; label: string }) {
  const router = useRouter();
  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const [pending, start] = useTransition();

  const send = () =>
    uploaded &&
    start(async () => {
      const r = await reuploadAction(orderId, uploaded.prescriptionId);
      if (!r.ok) return void toast.error(r.error.message);
      toast.success(r.message ?? "Sent");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <PrescriptionUploader familyMemberId={familyMemberId} label={label} onUploaded={setUploaded} />
      {uploaded ? (
        <>
          {uploaded.status === "SUCCEEDED" ? (
            <Alert tone="ok" title="This photo was read clearly">The pharmacist will verify it.</Alert>
          ) : (
            <Alert tone="warn" title="This photo is still hard to read">
              {uploaded.issues[0]} You can try again, or send it for the pharmacist to read manually.
            </Alert>
          )}
          <Button onClick={send} disabled={pending} size="lg">
            Send to pharmacist
          </Button>
        </>
      ) : null}
    </div>
  );
}
