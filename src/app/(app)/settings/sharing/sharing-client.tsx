"use client";

import { SharePermission } from "@prisma/client";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";

export function SharingClient() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.sharing.listOutbound.useQuery();
  const revokeTask = trpc.sharing.revokeTaskShare.useMutation({
    onSuccess: () => utils.sharing.listOutbound.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const revokeTag = trpc.sharing.revokeTagShare.useMutation({
    onSuccess: () => utils.sharing.listOutbound.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading shares…</p>;

  const taskShares = data?.taskShares ?? [];
  const tagShares = data?.tagShares ?? [];
  const empty = taskShares.length === 0 && tagShares.length === 0;

  return (
    <div className="grid gap-8 max-w-2xl">
      {empty ? (
        <p className="text-sm text-muted-foreground">
          You haven&apos;t shared anything yet. Use the Share action on a task or tag to grant
          another user access.
        </p>
      ) : null}

      {taskShares.length > 0 ? (
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Shared tasks
          </h2>
          <div className="grid gap-2">
            {taskShares.map((s) => (
              <Card key={s.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{s.task.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    shared with {s.sharedWith.name ?? s.sharedWith.email}
                  </div>
                </div>
                <Badge variant={s.permission === SharePermission.WRITE ? "default" : "secondary"}>
                  {s.permission === SharePermission.WRITE ? "read & write" : "read only"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => revokeTask.mutate({ id: s.id })}
                  title="Revoke"
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {tagShares.length > 0 ? (
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Shared tags
          </h2>
          <div className="grid gap-2">
            {tagShares.map((s) => (
              <Card key={s.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{s.tag.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    shared with {s.sharedWith.name ?? s.sharedWith.email}
                  </div>
                </div>
                <Badge variant={s.permission === SharePermission.WRITE ? "default" : "secondary"}>
                  {s.permission === SharePermission.WRITE ? "read & write" : "read only"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => revokeTag.mutate({ id: s.id })}
                  title="Revoke"
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
