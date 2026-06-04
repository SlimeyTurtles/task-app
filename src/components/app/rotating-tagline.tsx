"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Cycles through a list of strings with a soft fade-in on each swap.
 * Used for empty-state copy across the app so an unpopulated screen
 * has personality.
 *
 * SSR-safe: first render uses index 0 (deterministic), then on mount we
 * jump to a random one and start the rotation interval. That dodges the
 * hydration warning we'd get from Math.random() in the useState init.
 *
 * Picks the next index pseudo-randomly (never repeating the same one
 * twice in a row) so the same two-line dance doesn't recur every cycle.
 */
export function RotatingTagline({
  taglines,
  intervalMs = 9000,
  className,
}: {
  taglines: readonly string[];
  intervalMs?: number;
  className?: string;
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (taglines.length <= 1) return;
    setI(Math.floor(Math.random() * taglines.length));
    const id = setInterval(() => {
      setI(
        (x) =>
          (x + 1 + Math.floor(Math.random() * (taglines.length - 1))) %
          taglines.length,
      );
    }, intervalMs);
    return () => clearInterval(id);
  }, [taglines.length, intervalMs]);

  if (taglines.length === 0) return null;
  return (
    <span
      key={i}
      className={cn("inline-block animate-in fade-in-0 duration-700", className)}
    >
      {taglines[i]}
    </span>
  );
}
