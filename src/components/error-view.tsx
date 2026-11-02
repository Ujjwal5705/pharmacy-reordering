"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Alert, Button } from "./ui";

/** Shared route error boundary UI: plain-language message and a retry. Never shows raw error text. */
export function ErrorView({ reset, digest }: { reset: () => void; digest?: string }) {
  useEffect(() => {
    if (digest) console.error(`Route error ${digest}`);
  }, [digest]);
  return (
    <div className="mx-auto max-w-xl py-10">
      <Alert tone="bad" title="This page could not be loaded" action={<Button variant="outline" onClick={reset}><RotateCcw aria-hidden className="size-4" /> Try again</Button>}>
        Nothing was changed. Check your connection and try again. {digest ? <span className="text-xs text-muted">Reference: {digest}</span> : null}
      </Alert>
    </div>
  );
}
