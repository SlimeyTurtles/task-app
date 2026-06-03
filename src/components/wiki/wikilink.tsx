"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/**
 * Render markdown text with `[[Wikilinks]]` turned into clickable links.
 * Clicking a link to a non-existent page upserts (creates) it and
 * navigates — that's the Roam/Obsidian "links are creative" model.
 * Existing-link styling differs from broken/new so you can see at a
 * glance which pages have content yet.
 */
export function WikiText({
  text,
  knownTitles,
  className,
}: {
  text: string;
  /** Lowercased set of page titles that currently exist. */
  knownTitles: Set<string>;
  className?: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const upsert = trpc.wiki.upsertPage.useMutation();
  const [busy, setBusy] = useState(false);

  async function navigate(title: string) {
    if (busy) return;
    setBusy(true);
    try {
      const page = await upsert.mutateAsync({ title });
      await utils.wiki.listPages.invalidate();
      router.push(`/wiki/${page.slug}`);
    } finally {
      setBusy(false);
    }
  }

  const out: ReactNode[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    if (m.index > lastIndex) {
      out.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, m.index)}</span>);
    }
    const title = m[1].trim();
    const known = knownTitles.has(title.toLowerCase());
    out.push(
      <button
        key={`l-${m.index}`}
        type="button"
        onClick={() => navigate(title)}
        className={cn(
          "underline underline-offset-2 decoration-1 inline transition-colors",
          known
            ? "text-primary hover:text-primary/80"
            : "text-muted-foreground hover:text-foreground italic",
        )}
        title={known ? title : `Create page: ${title}`}
      >
        {title}
      </button>,
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    out.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return <div className={cn("whitespace-pre-wrap", className)}>{out}</div>;
}
