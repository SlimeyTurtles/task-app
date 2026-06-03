"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookText, FileText, NotebookText, Plus, Trash2, User } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { WikiText } from "@/components/wiki/wikilink";

/**
 * Two-pane wiki: left sidebar lists Profile + Pages + a link to /wiki/memories;
 * right pane shows either the profile editor or a single page editor.
 *
 * The "page" you're editing comes from the URL slug. When `slug` is undefined
 * we land on a landing screen ("pick a page or write the profile").
 */
export function WikiClient({ slug }: { slug?: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const { data: pages, isLoading: pagesLoading } = trpc.wiki.listPages.useQuery();
  const knownTitles = useMemo(
    () => new Set((pages ?? []).map((p) => p.title.toLowerCase())),
    [pages],
  );
  const { data: pendingMems } = trpc.wiki.listMemories.useQuery(
    { status: ["PENDING"], limit: 1 },
    { refetchInterval: 30_000 },
  );

  const isProfile = slug === "profile";
  const isPage = !!slug && !isProfile;

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r bg-card/30 overflow-y-auto">
        <div className="p-3">
          <Link
            href="/wiki/profile"
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent/50 transition-colors",
              isProfile && "bg-accent/60",
            )}
          >
            <User className="size-4 text-muted-foreground" />
            Profile
          </Link>
          <Link
            href="/wiki/memories"
            className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <NotebookText className="size-4 text-muted-foreground" />
              Memories
            </span>
            {pendingMems && pendingMems.length > 0 ? (
              <Badge variant="secondary" className="text-[10px]">new</Badge>
            ) : null}
          </Link>
          <NewPageButton />
        </div>
        <div className="px-2 pb-3">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Pages
          </p>
          {pagesLoading ? (
            <p className="px-2 text-xs text-muted-foreground">Loading…</p>
          ) : pages && pages.length > 0 ? (
            <div className="grid gap-0.5">
              {pages.map((p) => (
                <Link
                  key={p.id}
                  href={`/wiki/${p.slug}`}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 rounded-md text-sm hover:bg-accent/50 transition-colors",
                    isPage && slug === p.slug && "bg-accent/60",
                  )}
                >
                  <FileText className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{p.title}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-2 text-xs text-muted-foreground italic">No pages yet.</p>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {isProfile ? (
          <ProfileEditor knownTitles={knownTitles} />
        ) : isPage ? (
          <PageEditor
            slug={slug}
            knownTitles={knownTitles}
            onDeleted={() => {
              void utils.wiki.listPages.invalidate();
              router.push("/wiki");
            }}
          />
        ) : (
          <Landing />
        )}
      </main>
    </div>
  );
}

function Landing() {
  return (
    <div className="p-10 max-w-2xl">
      <h1 className="font-heading text-3xl tracking-tight">Second brain</h1>
      <p className="text-sm text-muted-foreground mt-2 max-w-md">
        A wiki the AI reads when it's making decisions on your behalf, and writes to
        when it learns something. Pick <strong>Profile</strong> to start (the always-on
        doc about you), or create a page for a person, project, or anything else.
      </p>
      <div className="mt-6 flex items-center gap-2">
        <Link
          href="/wiki/profile"
          className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:bg-primary/90 transition-colors"
        >
          <User className="size-4" /> Edit profile
        </Link>
        <Link
          href="/wiki/memories"
          className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors"
        >
          <NotebookText className="size-4" /> Browse memories
        </Link>
      </div>
      <p className="text-xs text-muted-foreground mt-6 max-w-md">
        Use <code className="font-mono bg-muted px-1 rounded">[[Wikilinks]]</code> to
        connect pages. Clicking a link to a page that doesn't exist yet creates it.
      </p>
    </div>
  );
}

// ── Profile editor ────────────────────────────────────────────────────
function ProfileEditor({ knownTitles }: { knownTitles: Set<string> }) {
  const { data: initial, isLoading } = trpc.wiki.getProfile.useQuery();
  const utils = trpc.useUtils();
  const save = trpc.wiki.updateProfile.useMutation({
    onSuccess: () => {
      void utils.wiki.getProfile.invalidate();
      setDirty(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!hydrated.current && initial != null) {
      setContent(initial);
      hydrated.current = true;
    }
  }, [initial]);

  // Autosave after 1s idle.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => save.mutate({ content }), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, dirty]);

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-baseline justify-between mb-2">
        <h1 className="font-heading text-2xl tracking-tight">Profile</h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {save.isPending ? "Saving…" : dirty ? "Unsaved" : "Saved"}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setPreview((v) => !v)}
          >
            {preview ? "Edit" : "Preview"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Always loaded into the AI's context. Keep it tight — who you are, what
        you're working on, how you work. Markdown supported.
      </p>
      {preview ? (
        <div className="rounded-lg border bg-card p-4 min-h-[24rem] prose-sm text-sm">
          {content.trim() ? (
            <WikiText text={content} knownTitles={knownTitles} />
          ) : (
            <p className="text-muted-foreground italic">Empty.</p>
          )}
        </div>
      ) : (
        <Textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          placeholder="Avinh, M.S. student at SFSU researching GNNs under [[Dr. Chen]]…"
          className="min-h-[24rem] font-mono text-sm"
        />
      )}
    </div>
  );
}

// ── Page editor ───────────────────────────────────────────────────────
function PageEditor({
  slug,
  knownTitles,
  onDeleted,
}: {
  slug: string;
  knownTitles: Set<string>;
  onDeleted: () => void;
}) {
  const { data: page, isLoading } = trpc.wiki.getPage.useQuery({ slug });
  const utils = trpc.useUtils();
  const save = trpc.wiki.upsertPage.useMutation({
    onSuccess: () => {
      void utils.wiki.listPages.invalidate();
      void utils.wiki.getPage.invalidate({ slug });
      setDirty(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.wiki.deletePage.useMutation({
    onSuccess: () => onDeleted(),
    onError: (e) => toast.error(e.message),
  });

  const [title, setTitle] = useState("");
  const [aliasesText, setAliasesText] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (page && !hydrated.current) {
      setTitle(page.title);
      setAliasesText(page.aliases.join(", "));
      setContent(page.content);
      hydrated.current = true;
    }
  }, [page]);

  // Autosave 1s idle.
  useEffect(() => {
    if (!dirty || !page) return;
    const t = setTimeout(() => {
      const aliases = aliasesText
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      save.mutate({ title, aliases, content });
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, aliasesText, content, dirty]);

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (!page) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">This page doesn't exist.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-baseline justify-between mb-2">
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          className="font-heading text-2xl tracking-tight border-0 px-0 shadow-none focus-visible:ring-0 h-auto py-1"
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0 ml-3">
          {save.isPending ? "Saving…" : dirty ? "Unsaved" : "Saved"}
          <Button type="button" size="sm" variant="ghost" onClick={() => setPreview((v) => !v)}>
            {preview ? "Edit" : "Preview"}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`Delete "${page.title}"? Links to it will break.`)) {
                del.mutate({ id: page.id });
              }
            }}
            aria-label="Delete page"
            title="Delete page"
          >
            <Trash2 className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[5rem_1fr] items-center gap-2 mb-3 text-xs">
        <span className="text-muted-foreground uppercase tracking-wider font-medium">
          Aliases
        </span>
        <Input
          value={aliasesText}
          onChange={(e) => {
            setAliasesText(e.target.value);
            setDirty(true);
          }}
          placeholder="comma-separated (e.g. PI, advisor)"
          className="h-7 text-xs"
        />
      </div>

      {preview ? (
        <div className="rounded-lg border bg-card p-4 min-h-[24rem] prose-sm text-sm">
          {content.trim() ? (
            <WikiText text={content} knownTitles={knownTitles} />
          ) : (
            <p className="text-muted-foreground italic">Empty.</p>
          )}
        </div>
      ) : (
        <Textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          placeholder="Markdown. Link other pages with [[Page Title]]."
          className="min-h-[24rem] font-mono text-sm"
        />
      )}
    </div>
  );
}

// ── New-page sidebar button ───────────────────────────────────────────
function NewPageButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const router = useRouter();
  const utils = trpc.useUtils();
  const create = trpc.wiki.upsertPage.useMutation({
    onSuccess: (page) => {
      void utils.wiki.listPages.invalidate();
      router.push(`/wiki/${page.slug}`);
      setOpen(false);
      setTitle("");
    },
    onError: (e) => toast.error(e.message),
  });
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors mt-1"
      >
        <Plus className="size-4" /> New page
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) create.mutate({ title: title.trim() });
      }}
      className="flex items-center gap-1 mt-1"
    >
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        onBlur={() => !title.trim() && setOpen(false)}
        placeholder="New page title"
        className="h-7 text-xs"
      />
      <Button type="submit" size="sm" disabled={!title.trim() || create.isPending}>
        <BookText className="size-3.5" />
      </Button>
    </form>
  );
}
