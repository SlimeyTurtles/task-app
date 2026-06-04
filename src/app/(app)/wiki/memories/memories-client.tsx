"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { RotatingTagline } from "@/components/app/rotating-tagline";

const MEMORIES_EMPTY = [
  "Nothing yet. Margaret hasn't recited the family tree at you.",
  "Empty. Even Linda's alphabetical Rolodex is just letters.",
  "Quiet. The AI is taking notes like Mike with his 'system.'",
  "Nothing. Patricia hasn't called to confirm the family reunion.",
  "Empty. Tony's 412 unread emails wish they were this tidy.",
  "Blank. Bertha hasn't dropped a bombshell about Aunt Carol yet.",
];

type Status = "PENDING" | "CONFIRMED" | "REJECTED" | "STALE" | "SUPERSEDED";

const STATUS_LABEL: Record<Status, string> = {
  PENDING: "Unverified",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
  STALE: "Stale",
  SUPERSEDED: "Superseded",
};

const STATUS_TONE: Record<Status, string> = {
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  CONFIRMED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  REJECTED: "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200",
  STALE: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-300",
  SUPERSEDED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800/40 dark:text-zinc-400",
};

export function MemoriesClient() {
  const utils = trpc.useUtils();
  const { data: memories, isLoading } = trpc.wiki.listMemories.useQuery({});
  const create = trpc.wiki.createMemory.useMutation({
    onSuccess: () => {
      void utils.wiki.listMemories.invalidate();
      setNewContent("");
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.wiki.updateMemory.useMutation({
    onSuccess: () => utils.wiki.listMemories.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.wiki.deleteMemory.useMutation({
    onSuccess: () => utils.wiki.listMemories.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const grouped = ((memories ?? []) as Array<NonNullable<typeof memories>[number]>).reduce(
    (acc, m) => {
      const s = m.status as Status;
      (acc[s] ??= []).push(m);
      return acc;
    },
    {} as Record<Status, Array<NonNullable<typeof memories>[number]>>,
  );

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="font-heading text-2xl tracking-tight">Memories</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Atomic facts the AI uses when planning. New ones land here as
        <Badge variant="secondary" className="mx-1 text-[10px]">Unverified</Badge>
        until you confirm or reject them.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newContent.trim()) create.mutate({ content: newContent.trim() });
        }}
        className="mt-5 flex items-start gap-2"
      >
        <Input
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="Add a fact — e.g. 'Avinh's PI is Dr. Chen.'"
        />
        <Button type="submit" size="sm" disabled={!newContent.trim() || create.isPending}>
          <Plus className="size-4" /> Add
        </Button>
      </form>

      <div className="mt-6 grid gap-6">
        {(["PENDING", "STALE", "CONFIRMED", "REJECTED", "SUPERSEDED"] as Status[]).map((status) => {
          const list = grouped[status] ?? [];
          if (list.length === 0) return null;
          return (
            <section key={status} className="grid gap-2">
              <h2 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {STATUS_LABEL[status]} ({list.length})
              </h2>
              <div className="grid gap-1.5">
                {list.map((m) => {
                  const isEditing = editingId === m.id;
                  return (
                    <div
                      key={m.id}
                      className="group flex items-start gap-2 rounded-lg border bg-card px-3 py-2"
                    >
                      <Badge
                        className={cn(
                          "shrink-0 mt-0.5 text-[10px] font-medium",
                          STATUS_TONE[m.status as Status],
                        )}
                      >
                        {STATUS_LABEL[m.status as Status]}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <Textarea
                            autoFocus
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="min-h-12 text-sm"
                          />
                        ) : (
                          <p className="text-sm leading-relaxed">{m.content}</p>
                        )}
                        {m.supersedes ? (
                          <p className="text-[11px] text-muted-foreground mt-1 italic">
                            Replaces: {m.supersedes.content}
                          </p>
                        ) : null}
                        {m.source ? (
                          <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                            via {m.source} · {new Date(m.createdAt).toLocaleDateString()}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isEditing ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => {
                                if (editText.trim() && editText.trim() !== m.content) {
                                  update.mutate({ id: m.id, content: editText.trim() });
                                }
                                setEditingId(null);
                              }}
                              aria-label="Save"
                            >
                              <Check className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setEditingId(null)}
                              aria-label="Cancel"
                            >
                              <X className="size-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            {m.status !== "CONFIRMED" ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => update.mutate({ id: m.id, status: "CONFIRMED" })}
                                aria-label="Confirm"
                                title="Confirm"
                              >
                                <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                              </Button>
                            ) : null}
                            {m.status !== "REJECTED" ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => update.mutate({ id: m.id, status: "REJECTED" })}
                                aria-label="Reject"
                                title="Reject"
                              >
                                <X className="size-3.5 text-red-600 dark:text-red-400" />
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => {
                                setEditingId(m.id);
                                setEditText(m.content);
                              }}
                              aria-label="Edit"
                              title="Edit"
                            >
                              <Pencil className="size-3.5 text-muted-foreground" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => {
                                if (confirm("Delete this memory? Can't undo.")) {
                                  del.mutate({ id: m.id });
                                }
                              }}
                              aria-label="Delete"
                              title="Delete"
                            >
                              <Trash2 className="size-3.5 text-muted-foreground" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : memories && memories.length === 0 ? (
          <div className="py-6 text-center grid gap-1.5">
            <p className="font-heading text-lg tracking-tight">
              <RotatingTagline taglines={MEMORIES_EMPTY} />
            </p>
            <p className="text-xs text-muted-foreground">
              AI will drop suggestions here as it learns. You can also add facts manually above.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
