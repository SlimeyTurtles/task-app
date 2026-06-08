"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

export function ApiKeysClient() {
  const utils = trpc.useUtils();
  const { data: keys, isLoading } = trpc.apiKeys.list.useQuery();
  const create = trpc.apiKeys.create.useMutation({
    onSuccess: (k) => {
      void utils.apiKeys.list.invalidate();
      setJustIssued({ key: k.key, name: k.name, keyPrefix: k.keyPrefix });
      setNewName("");
    },
    onError: (e) => toast.error(e.message),
  });
  const revoke = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => utils.apiKeys.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const [newName, setNewName] = useState("");
  const [justIssued, setJustIssued] = useState<{ key: string; name: string; keyPrefix: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  async function copyKey() {
    if (!justIssued) return;
    try {
      await navigator.clipboard.writeText(justIssued.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — long-press to copy manually.");
    }
  }

  return (
    <div className="p-6 max-w-2xl grid gap-6">
      <div>
        <h1 className="font-heading text-2xl tracking-tight">API keys</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tokens that grant external clients (Claude CLI / MCP / your own scripts)
          access to your Almanac account. Each key has full read/write access — treat
          it like a password.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a new key</CardTitle>
          <CardDescription>
            Give it a memorable name so you can revoke the right one later (e.g. "Claude CLI").
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate({ name: newName.trim() });
            }}
            className="flex items-end gap-2"
          >
            <div className="flex-1 grid gap-1.5">
              <Label htmlFor="key-name" className="text-xs text-muted-foreground">Name</Label>
              <Input
                id="key-name"
                placeholder="Claude CLI"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={!newName.trim() || create.isPending}>
              <Plus className="size-4" /> Issue
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Once-shown reveal panel for a freshly issued key */}
      {justIssued ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="size-4" /> {justIssued.name}
            </CardTitle>
            <CardDescription>
              Copy this now — it won't be shown again. After this, you'll only see
              the prefix.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-background border rounded px-2 py-1.5 text-xs font-mono overflow-x-auto whitespace-nowrap">
                {justIssued.key}
              </code>
              <Button type="button" size="sm" variant="outline" onClick={copyKey}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setJustIssued(null)}
              className="justify-self-end"
            >
              I've saved it
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Active keys ({keys?.length ?? 0})
        </h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : keys && keys.length > 0 ? (
          <div className="grid gap-2">
            {keys.map((k) => {
              const expired = k.expiresAt && k.expiresAt < new Date();
              return (
                <div
                  key={k.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border bg-card px-3 py-2",
                    expired && "opacity-60",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{k.name}</span>
                      <code className="font-mono text-xs text-muted-foreground">
                        alm_{k.keyPrefix}_…
                      </code>
                      {expired ? <Badge variant="destructive" className="text-[10px]">expired</Badge> : null}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      created {new Date(k.createdAt).toLocaleDateString()}
                      {k.lastUsedAt
                        ? ` · last used ${new Date(k.lastUsedAt).toLocaleString()}`
                        : " · never used"}
                      {k.expiresAt
                        ? ` · expires ${new Date(k.expiresAt).toLocaleDateString()}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      if (confirm(`Revoke "${k.name}"? Any client using it will break immediately.`)) {
                        revoke.mutate({ id: k.id });
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
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No keys yet.
          </p>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Using with Claude CLI</CardTitle>
          <CardDescription>
            Once you have a key, plug it into the CLI as an MCP server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted/50 border rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre">
{`claude mcp add almanac \\
  --transport http \\
  https://almanac.avinh.net/api/mcp \\
  --header "Authorization: Bearer <your-key>"`}
          </pre>
          <p className="text-[11px] text-muted-foreground mt-2">
            After that, Claude CLI gets tools like <code className="font-mono">mcp__almanac__create_task</code>,
            {" "}<code className="font-mono">mcp__almanac__append_message</code>, etc.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
