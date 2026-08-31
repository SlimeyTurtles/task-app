"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DatabaseZap, RefreshCw } from "lucide-react";

import { useUiStore } from "@/lib/store";

export function isDbUnreachableClientError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const data = (error as { data?: { dbUnreachable?: boolean } }).data;
  return data?.dbUnreachable === true;
}

export function DbDownBanner() {
  const dbDown = useUiStore((s) => s.dbDown);
  const setDbDown = useUiStore((s) => s.setDbDown);
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  if (!dbDown) return null;

  async function retry() {
    setRetrying(true);
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        setDbDown(false);
        await queryClient.refetchQueries({ type: "active" });
      }
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      role="alert"
      className="shrink-0 flex items-center justify-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <DatabaseZap className="size-4 shrink-0" aria-hidden />
      <span>
        <span className="font-medium">The database is unreachable.</span> Your changes can&apos;t be
        saved right now.
      </span>
      <button
        onClick={retry}
        disabled={retrying}
        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium hover:bg-destructive/10 disabled:opacity-50"
      >
        <RefreshCw className={`size-3 ${retrying ? "animate-spin" : ""}`} aria-hidden />
        Retry
      </button>
    </div>
  );
}
