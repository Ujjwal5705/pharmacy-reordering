"use client";

import { useState } from "react";
import { ExternalLink, RotateCw, ZoomIn, ZoomOut } from "lucide-react";

/** Original prescription with zoom/rotate so the pharmacist can read small or skewed text. */
export function PrescriptionViewer({ id, mimeType, viewKey }: { id: string; mimeType: string; viewKey: string }) {
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const src = `/api/prescriptions/${id}/file?view=${viewKey}`;
  const btn = "grid size-10 place-items-center rounded-lg border border-line bg-surface hover:bg-canvas disabled:opacity-40";
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="mr-auto text-sm font-semibold">Original prescription</span>
        {mimeType !== "application/pdf" ? (
          <>
            <button type="button" className={btn} aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
              <ZoomOut aria-hidden className="size-4" />
            </button>
            <span className="w-12 text-center text-sm tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button type="button" className={btn} aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
              <ZoomIn aria-hidden className="size-4" />
            </button>
            <button type="button" className={btn} aria-label="Rotate 90 degrees" onClick={() => setRot((r) => (r + 90) % 360)}>
              <RotateCw aria-hidden className="size-4" />
            </button>
          </>
        ) : null}
        <a href={src} target="_blank" rel="noopener noreferrer" className={btn} aria-label="Open in a new tab (access is logged)">
          <ExternalLink aria-hidden className="size-4" />
        </a>
      </div>
      {mimeType === "application/pdf" ? (
        <iframe src={src} title="Prescription PDF" className="h-[75vh] w-full bg-white" />
      ) : (
        <div className="h-[75vh] overflow-auto bg-[#eef1ef] p-3" data-testid="rx-image">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated file */}
          <img
            src={src}
            alt="Uploaded prescription"
            style={{ width: `${zoom * 100}%`, transform: `rotate(${rot}deg)`, transformOrigin: "center", maxWidth: "none" }}
            className="mx-auto rounded bg-white shadow-sm transition-[width]"
          />
        </div>
      )}
      <p className="border-t border-line px-3 py-2 text-xs text-muted">Every view of this file is recorded in the audit trail.</p>
    </div>
  );
}
