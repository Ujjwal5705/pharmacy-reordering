"use client";

import { useRef, useState } from "react";
import { Camera, FileUp, Loader2 } from "lucide-react";
import { Alert, Button } from "@/components/ui";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = ["image/jpeg", "image/png", "application/pdf"];

export type UploadResult = { prescriptionId: string; status: string; issues: string[] };

/**
 * Uploads with XMLHttpRequest so the customer sees real progress. The server re-validates
 * everything; the checks here only give faster feedback.
 */
export function PrescriptionUploader({ familyMemberId, onUploaded, label = "Upload prescription" }: { familyMemberId: string; onUploaded: (r: UploadResult) => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "reading">("idle");
  const [error, setError] = useState<string | null>(null);

  function upload(file: File) {
    setError(null);
    if (!ACCEPT.includes(file.type) && file.type !== "") return setError("Only JPEG, PNG or PDF files are accepted.");
    if (file.size > MAX_BYTES) return setError("The file is larger than 8 MB. Try a smaller photo.");
    if (file.size === 0) return setError("The file is empty.");

    const form = new FormData();
    form.append("familyMemberId", familyMemberId);
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/prescriptions");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.upload.onload = () => setPhase("reading");
    xhr.onerror = () => {
      setPhase("idle");
      setProgress(null);
      setError("Upload failed — check your connection and try again.");
    };
    xhr.onload = () => {
      setPhase("idle");
      setProgress(null);
      if (input.current) input.current.value = "";
      if (xhr.status >= 200 && xhr.status < 300) onUploaded(xhr.response as UploadResult);
      else setError((xhr.response as { error?: { message?: string } })?.error?.message ?? "Upload failed. Please try again.");
    };
    setPhase("uploading");
    setProgress(0);
    xhr.send(form);
  }

  const busy = phase !== "idle";
  return (
    <div className="space-y-3">
      <input
        ref={input}
        id={`rx-file-${familyMemberId}`}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="sr-only"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        disabled={busy}
        data-testid="rx-file-input"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="lg" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 aria-hidden className="size-5 animate-spin" /> : <FileUp aria-hidden className="size-5" />}
          {label}
        </Button>
        <span className="inline-flex items-center gap-1 text-sm text-muted">
          <Camera aria-hidden className="size-4" /> Photo or PDF, up to 8 MB. Make sure the whole page is visible.
        </span>
      </div>
      {busy ? (
        <div role="status" aria-live="polite" className="space-y-1.5">
          <div className="h-2.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${phase === "reading" ? 100 : (progress ?? 0)}%` }} />
          </div>
          <p className="text-sm text-muted">{phase === "uploading" ? `Uploading securely… ${progress ?? 0}%` : "Reading the prescription (draft for the pharmacist)…"}</p>
        </div>
      ) : null}
      {error ? <Alert tone="bad" title="Upload not accepted">{error}</Alert> : null}
    </div>
  );
}
