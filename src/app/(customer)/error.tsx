"use client";

import { ErrorView } from "@/components/error-view";

export default function CustomerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView reset={reset} digest={error.digest} />;
}
