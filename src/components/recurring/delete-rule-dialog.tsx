"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc/client";

type Rule = {
  taskId: string;
  task: { name: string };
};

type Scope = "rule_only" | "future" | "all";

const OPTIONS: { value: Scope; title: string; hint: string }[] = [
  {
    value: "rule_only",
    title: "Stop future generation only",
    hint: "Keep every task this template has already created. Just won't make more.",
  },
  {
    value: "future",
    title: "Also delete upcoming untouched tasks",
    hint: "Drop INBOX/SCHEDULED tasks dated today or later that haven't been logged. Past stays.",
  },
  {
    value: "all",
    title: "Delete all untouched tasks",
    hint: "Drop every materialized task with no completions or events, past and future.",
  },
];

export function DeleteRuleDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [scope, setScope] = useState<Scope>("future");

  const del = trpc.recurrence.delete.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.recurrence.list.invalidate(), utils.tasks.list.invalidate()]);
      toast.success("Recurrence removed.");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={rule != null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{rule?.task.name}&rdquo; template</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`grid grid-cols-[auto_1fr] gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${
                scope === o.value ? "border-foreground/60" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="del-scope"
                checked={scope === o.value}
                onChange={() => setScope(o.value)}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-medium">{o.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{o.hint}</p>
              </div>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() => rule && del.mutate({ taskId: rule.taskId, scope })}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
