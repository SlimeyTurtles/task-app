"use client";

import { useEffect, useState } from "react";
import { DatabaseZap, RefreshCw, TriangleAlert } from "lucide-react";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  // Server-component error messages are masked in production, so ask the
  // health endpoint whether the database is the culprit.
  const [dbDown, setDbDown] = useState<boolean | null>(null);

  useEffect(() => {
    console.error(error);
    let cancelled = false;
    fetch("/api/health")
      .then((res) => {
        if (!cancelled) setDbDown(!res.ok);
      })
      .catch(() => {
        if (!cancelled) setDbDown(null);
      });
    return () => {
      cancelled = true;
    };
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/[0.06] p-8 text-center">
        {dbDown ? (
          <>
            <DatabaseZap className="mx-auto size-8 text-destructive" aria-hidden />
            <h2 className="font-heading mt-4 text-xl font-semibold">The database is unreachable</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              The app can&apos;t talk to its database right now, so nothing can be loaded or saved.
              Check that Postgres is running, then try again.
            </p>
          </>
        ) : (
          <>
            <TriangleAlert className="mx-auto size-8 text-destructive" aria-hidden />
            <h2 className="font-heading mt-4 text-xl font-semibold">Something went wrong</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              An unexpected error interrupted this page.
              {error.digest ? (
                <>
                  {" "}
                  Error ID: <code className="font-mono text-xs">{error.digest}</code>
                </>
              ) : null}
            </p>
          </>
        )}
        <button
          onClick={() => unstable_retry()}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Try again
        </button>
      </div>
    </div>
  );
}
