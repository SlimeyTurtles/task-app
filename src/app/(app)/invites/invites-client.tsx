"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

function inviteUrl(code: string): string {
  if (typeof window === "undefined") return `/register?invite=${code}`;
  return `${window.location.origin}/register?invite=${code}`;
}

function relTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const d = Math.floor(diff / 86_400_000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(diff / 3_600_000);
  if (h > 0) return `${h}h ago`;
  const m = Math.floor(diff / 60_000);
  if (m > 0) return `${m}m ago`;
  return "just now";
}

export function InvitesClient() {
  const utils = trpc.useUtils();
  const { data: invites, isLoading } = trpc.invites.list.useQuery();

  const create = trpc.invites.create.useMutation({
    onSuccess: () => utils.invites.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const revoke = trpc.invites.revoke.useMutation({
    onSuccess: () => utils.invites.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const sendEmail = trpc.invites.sendEmail.useMutation({
    onSuccess: (res) => toast.success(`Sent to ${res.to}`),
    onError: (e) => toast.error(e.message),
  });

  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number | "">(14);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Inline ad-hoc "send to..." input for invites that aren't email-locked.
  const [sendToById, setSendToById] = useState<Record<string, string>>({});

  async function copyLink(code: string, id: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1500);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Couldn't copy — long-press to copy manually.");
    }
  }

  const { pending, used } = useMemo(() => {
    const p: NonNullable<typeof invites> = [];
    const u: NonNullable<typeof invites> = [];
    for (const i of invites ?? []) {
      (i.usedAt ? u : p).push(i);
    }
    return { pending: p, used: u };
  }, [invites]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({
      email: email.trim() || null,
      note: note.trim() || null,
      expiresInDays: typeof expiresInDays === "number" ? expiresInDays : null,
    });
    setEmail("");
    setNote("");
  }

  return (
    <div className="max-w-3xl mx-auto p-6 grid gap-6 w-full">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Invites</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Signup is gated. Generate a code, share the link, watch it get claimed.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New invite</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-[1fr_1fr_6rem_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="email" className="text-xs text-muted-foreground">Email (optional)</Label>
              <Input
                id="email"
                type="email"
                placeholder="Lock to this address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="note" className="text-xs text-muted-foreground">Note (optional)</Label>
              <Input
                id="note"
                placeholder="e.g. for Sarah"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="exp" className="text-xs text-muted-foreground">Expires (days)</Label>
              <Input
                id="exp"
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setExpiresInDays(Number.isFinite(n) ? n : "");
                }}
              />
            </div>
            <Button type="submit" disabled={create.isPending}>
              <Plus className="size-4" /> Generate
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="grid gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Pending ({pending.length})
        </h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No pending invites.</p>
        ) : (
          <div className="grid gap-2">
            {pending.map((inv) => {
              const expired = inv.expiresAt && inv.expiresAt < new Date();
              return (
                <div
                  key={inv.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border bg-card px-3 py-2",
                    expired && "opacity-60",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-sm tracking-wider">{inv.code}</code>
                      {inv.email ? <Badge variant="secondary" className="text-xs">{inv.email}</Badge> : null}
                      {expired ? <Badge variant="destructive" className="text-xs">expired</Badge> : null}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-baseline gap-2 flex-wrap">
                      {inv.note ? <span>{inv.note}</span> : null}
                      <span>created {relTime(new Date(inv.createdAt))}</span>
                      {inv.expiresAt ? (
                        <span>
                          {expired ? "expired " : "expires "}
                          {new Date(inv.expiresAt).toLocaleDateString()}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copyLink(inv.code, inv.id)}
                  >
                    {copiedId === inv.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copiedId === inv.id ? "Copied" : "Copy link"}
                  </Button>
                  {/* If the invite is email-locked we send it to that address
                      with one click. If it isn't, show a tiny input so the
                      admin can fire off a one-off send. */}
                  {inv.email ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(expired) || sendEmail.isPending}
                      onClick={() =>
                        sendEmail.mutate({
                          id: inv.id,
                          origin: window.location.origin,
                        })
                      }
                    >
                      <Send className="size-3.5" /> Send
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="email"
                        placeholder="email@…"
                        className="h-8 w-44 text-xs"
                        value={sendToById[inv.id] ?? ""}
                        onChange={(e) =>
                          setSendToById((m) => ({ ...m, [inv.id]: e.target.value }))
                        }
                        disabled={Boolean(expired)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          Boolean(expired) ||
                          sendEmail.isPending ||
                          !(sendToById[inv.id]?.trim())
                        }
                        onClick={() =>
                          sendEmail.mutate({
                            id: inv.id,
                            to: sendToById[inv.id]?.trim() || null,
                            origin: window.location.origin,
                          })
                        }
                      >
                        <Send className="size-3.5" />
                      </Button>
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      if (confirm(`Revoke invite ${inv.code}?`)) {
                        void revoke.mutateAsync({ id: inv.id });
                      }
                    }}
                    aria-label="Revoke"
                    title="Revoke"
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {used.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Claimed ({used.length})
          </h2>
          <div className="grid gap-2">
            {used.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 rounded-lg border border-dashed bg-card/40 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-sm tracking-wider text-muted-foreground line-through">
                      {inv.code}
                    </code>
                    <Badge variant="secondary" className="text-xs">
                      {inv.usedBy?.email ?? "claimed"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {inv.note ? <span>{inv.note} · </span> : null}
                    claimed {inv.usedAt ? relTime(new Date(inv.usedAt)) : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
