"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderPlus, MessageSquare, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { RotatingTagline } from "@/components/app/rotating-tagline";

const JOURNAL_EMPTY = [
  "No journals. Esmeralda hasn't logged today's ball-buffing session.",
  "Empty. Kazimir's dream-atlas notebook is still blank.",
  "Quiet. Gertrude hasn't filed a haunting transcript yet.",
  "Empty. Petros's plants are between sessions.",
  "Nothing. Wendell's hand cramped halfway through cookie #14.",
  "Empty. Mireille's mer-ledger has no entries this tide.",
  "No journals. Bartholomew claims he wrote one, twice.",
  "Empty. Lucinda's cryptid book club hasn't picked a title.",
];

export function JournalClient({ sessionId }: { sessionId?: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const { data: folders } = trpc.chat.listFolders.useQuery();
  const { data: sessions, isLoading: sessionsLoading } = trpc.chat.listSessions.useQuery({});
  const session = trpc.chat.getSession.useQuery(
    { id: sessionId ?? "" },
    { enabled: Boolean(sessionId) },
  );

  const createFolder = trpc.chat.createFolder.useMutation({
    onSuccess: () => utils.chat.listFolders.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const createSession = trpc.chat.createSession.useMutation({
    onSuccess: (s) => {
      void utils.chat.listSessions.invalidate();
      router.push(`/journal/${s.id}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const delSession = trpc.chat.deleteSession.useMutation({
    onSuccess: () => {
      void utils.chat.listSessions.invalidate();
      router.push("/journal");
    },
    onError: (e) => toast.error(e.message),
  });

  const [folderName, setFolderName] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r bg-card/30 overflow-y-auto">
        <div className="p-3 border-b">
          <Button
            type="button"
            size="sm"
            className="w-full"
            onClick={() => createSession.mutate({ title: "New session" })}
          >
            <Plus className="size-4" /> New session
          </Button>
        </div>

        <div className="p-2">
          <div className="flex items-center justify-between px-2 mb-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Folders
            </p>
            <button
              type="button"
              onClick={() => setFolderOpen((v) => !v)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="New folder"
              title="New folder"
            >
              <FolderPlus className="size-3.5" />
            </button>
          </div>
          {folderOpen ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (folderName.trim()) {
                  createFolder.mutate({ name: folderName.trim() });
                  setFolderName("");
                  setFolderOpen(false);
                }
              }}
              className="px-2 mb-2"
            >
              <Input
                autoFocus
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="Folder name"
                className="h-7 text-xs"
                onKeyDown={(e) => e.key === "Escape" && setFolderOpen(false)}
              />
            </form>
          ) : null}
          {folders && folders.length > 0 ? (
            <div className="grid gap-0.5">
              {folders.map((f) => (
                <div
                  key={f.id}
                  className="px-2 py-1 rounded-md text-xs text-muted-foreground flex items-center justify-between"
                >
                  <span className="truncate">{f.name}</span>
                  <span className="text-[10px]">{f._count.sessions}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="p-2 border-t">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Sessions
          </p>
          {sessionsLoading ? (
            <p className="px-2 text-xs text-muted-foreground">Loading…</p>
          ) : sessions && sessions.length > 0 ? (
            <div className="grid gap-0.5">
              {sessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/journal/${s.id}`}
                  className={cn(
                    "block px-2 py-1.5 rounded-md text-sm hover:bg-accent/50 transition-colors",
                    sessionId === s.id && "bg-accent/60",
                  )}
                >
                  <div className="truncate">{s.title}</div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                    <span>{s._count.messages} msg</span>
                    {s.model ? <span className="font-mono">· {s.model}</span> : null}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-2 py-2 text-xs text-muted-foreground italic">
              <RotatingTagline taglines={JOURNAL_EMPTY} />
            </p>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {sessionId && session.data ? (
          <div className="p-6 max-w-3xl">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <h1 className="font-heading text-2xl tracking-tight">{session.data.title}</h1>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                  {session.data.model ? (
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {session.data.model}
                    </Badge>
                  ) : null}
                  <span>{session.data.messages.length} messages</span>
                  <span>
                    started {new Date(session.data.createdAt).toLocaleDateString()}
                  </span>
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  if (confirm(`Delete "${session.data?.title}"?`)) {
                    delSession.mutate({ id: session.data!.id });
                  }
                }}
                aria-label="Delete session"
              >
                <Trash2 className="size-4 text-muted-foreground" />
              </Button>
            </div>

            <div className="grid gap-4">
              {session.data.messages.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No messages yet. Append via the MCP <code className="font-mono">append_message</code>
                  {" "}tool from Claude CLI, or hand-add later.
                </p>
              ) : (
                session.data.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "rounded-lg px-4 py-3 text-sm leading-relaxed",
                      m.role === "USER"
                        ? "bg-primary/5 border border-primary/20"
                        : m.role === "ASSISTANT"
                          ? "bg-card border"
                          : "bg-muted/40 border border-dashed text-muted-foreground italic",
                    )}
                  >
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                      {m.role.toLowerCase()}
                      <span className="ml-2 font-normal normal-case">
                        {new Date(m.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="p-10 max-w-2xl">
            <h1 className="font-heading text-3xl tracking-tight">
              <RotatingTagline taglines={JOURNAL_EMPTY} />
            </h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-md">
              Where your Claude CLI conversations land when you ask the CLI to log them.
              Hand-create a session from the sidebar to start, or set up the MCP server
              (Settings → API & Webhooks → API keys) and let the CLI populate this.
            </p>
            <div className="mt-6 flex items-center gap-2">
              <Button onClick={() => createSession.mutate({ title: "New session" })}>
                <MessageSquare className="size-4" /> New session
              </Button>
              <Link
                href="/settings/api"
                className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors"
              >
                <Plus className="size-4" /> Set up Claude CLI
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
