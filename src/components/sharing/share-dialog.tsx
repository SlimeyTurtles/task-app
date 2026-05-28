"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SharePermission } from "@prisma/client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc/client";

export type ShareTarget =
  | { kind: "task"; id: string; name: string }
  | { kind: "tag"; id: string; name: string };

export function ShareDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ShareTarget | null;
}) {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<SharePermission>(SharePermission.READ);

  useEffect(() => {
    if (open) {
      setEmail("");
      setPermission(SharePermission.READ);
    }
  }, [open]);

  const shareTask = trpc.sharing.shareTask.useMutation();
  const shareTag = trpc.sharing.shareTag.useMutation();
  const pending = shareTask.isPending || shareTag.isPending;

  async function submit() {
    if (!target) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      toast.error("Enter an email.");
      return;
    }
    try {
      if (target.kind === "task") {
        await shareTask.mutateAsync({ taskId: target.id, email: trimmed, permission });
      } else {
        await shareTag.mutateAsync({ tagId: target.id, email: trimmed, permission });
      }
      toast.success(`Shared "${target.name}" with ${trimmed}.`);
      await utils.sharing.listOutbound.invalidate();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to share.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share {target?.kind === "tag" ? "tag" : "task"}</DialogTitle>
          <DialogDescription>
            {target ? (
              <>
                Give another user access to <span className="font-medium">{target.name}</span>.
                {target.kind === "tag"
                  ? " They'll see tasks carrying this tag."
                  : " They'll see only this task."}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="share-email">Email</Label>
            <Input
              id="share-email"
              type="email"
              placeholder="collaborator@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="share-permission">Permission</Label>
            <select
              id="share-permission"
              value={permission}
              onChange={(e) => setPermission(e.target.value as SharePermission)}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value={SharePermission.READ}>Read only</option>
              <option value={SharePermission.WRITE}>Read &amp; write</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Sharing…" : "Share"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
