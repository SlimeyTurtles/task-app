"use client";

import { useState } from "react";
import { CalendarPlus, Check, MoreHorizontal, RotateCcw, Share2, Sparkles, Trash2, Undo2 } from "lucide-react";
import { TaskStatus } from "@prisma/client";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatRelativeDue } from "@/lib/format";
import { trpc } from "@/lib/trpc/client";
import { CompletionDialog } from "./completion-dialog";
import { ShareDialog } from "@/components/sharing/share-dialog";

export type TaskListItemTask = {
  id: string;
  name: string;
  status: TaskStatus;
  dueDate: Date | null;
  stress: number | null;
  exhaustion: number | null;
  estimatedMinutes: number | null;
  area: { id: string; name: string; color: string | null } | null;
  project: { id: string; name: string } | null;
  tags: { tag: { id: string; name: string; color: string | null } }[];
  _count?: { subtasks: number; outgoingDeps: number };
};

export function TaskListItem({
  task,
  onClick,
}: {
  task: TaskListItemTask;
  onClick?: (taskId: string) => void;
}) {
  const utils = trpc.useUtils();
  const update = trpc.tasks.update.useMutation({
    onSuccess: () => {
      void utils.tasks.list.invalidate();
      void utils.tasks.get.invalidate();
    },
  });
  const del = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      void utils.tasks.list.invalidate();
    },
  });
  const aiSchedule = trpc.tasks.aiSchedule.useMutation({
    onSuccess: (r) => {
      void utils.tasks.list.invalidate();
      void utils.events.list.invalidate();
      const newTitle = r.task.name !== task.name ? ` as "${r.task.name}"` : "";
      const when = new Date(r.event.startsAt).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      });
      toast.success(`Scheduled${newTitle} for ${when}.`);
    },
    onError: (e) => toast.error(e.message),
  });
  const dropOnCalendar = trpc.events.dropOnCalendar.useMutation({
    onSuccess: () => {
      void utils.events.list.invalidate();
      toast.success("Dropped on your calendar — drag it to the right spot.");
    },
    onError: (e) => toast.error(e.message),
  });
  const [busy, setBusy] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const done = task.status === TaskStatus.DONE;
  const dropped = task.status === TaskStatus.DROPPED;
  const dueLabel = formatRelativeDue(task.dueDate);
  const dueOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !done;

  async function toggleDone(next: boolean) {
    if (next) {
      // Marking done → open completion dialog (handles the actual mutation).
      setCompletionOpen(true);
      return;
    }
    setBusy(true);
    try {
      await update.mutateAsync({ id: task.id, status: TaskStatus.INBOX });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update task.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: TaskStatus) {
    setBusy(true);
    try {
      await update.mutateAsync({ id: task.id, status });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update task.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${task.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await del.mutateAsync({ id: task.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete task.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "group flex items-start gap-3 px-3 py-2 rounded-md border bg-card hover:bg-accent/40 transition-colors",
        (done || dropped) && "opacity-60",
        busy && "pointer-events-none opacity-50",
      )}
    >
      <Checkbox
        checked={done}
        onCheckedChange={(v) => toggleDone(Boolean(v))}
        className="mt-1"
        aria-label={done ? "Mark not done" : "Mark done"}
      />
      <button
        type="button"
        className="flex-1 text-left min-w-0"
        onClick={() => onClick?.(task.id)}
      >
        <div className={cn("text-sm font-medium truncate", done && "line-through")}>
          {task.name}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1 items-center text-xs text-muted-foreground">
          {task.area ? (
            <Badge variant="outline" className="font-normal">
              {task.area.name}
            </Badge>
          ) : null}
          {task.project ? (
            <Badge variant="outline" className="font-normal">
              {task.project.name}
            </Badge>
          ) : null}
          {task.tags.map(({ tag }) => (
            <Badge key={tag.id} variant="secondary" className="font-normal">
              {tag.name}
            </Badge>
          ))}
          {dueLabel ? (
            <span className={cn(dueOverdue && "text-destructive font-medium")}>{dueLabel}</span>
          ) : null}
          {task.estimatedMinutes ? <span>{task.estimatedMinutes}m</span> : null}
          {task.stress != null ? <span title="Stress">⚡{task.stress}</span> : null}
          {task.exhaustion != null ? <span title="Exhaustion">🪫{task.exhaustion}</span> : null}
          {task._count?.subtasks ? <span>{task._count.subtasks} subtasks</span> : null}
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Task actions"
              className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {!done ? (
            <DropdownMenuItem onClick={() => setStatus(TaskStatus.DONE)}>
              <Check className="size-4 mr-2" /> Mark done
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setStatus(TaskStatus.INBOX)}>
              <Undo2 className="size-4 mr-2" /> Move back to inbox
            </DropdownMenuItem>
          )}
          {!done && !dropped ? (
            <>
              <DropdownMenuItem
                onClick={() => aiSchedule.mutate({ id: task.id })}
                disabled={aiSchedule.isPending}
              >
                <Sparkles className="size-4 mr-2" />
                {aiSchedule.isPending ? "AI scheduling…" : "AI schedule"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  dropOnCalendar.mutate({
                    taskId: task.id,
                    estimatedMinutes: task.estimatedMinutes ?? undefined,
                  })
                }
              >
                <CalendarPlus className="size-4 mr-2" /> Drop on calendar
              </DropdownMenuItem>
            </>
          ) : null}
          {!dropped ? (
            <DropdownMenuItem onClick={() => setStatus(TaskStatus.DROPPED)}>
              <RotateCcw className="size-4 mr-2" /> Drop
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={() => {
              // Defer so the menu finishes closing before the dialog opens —
              // otherwise base-ui's focus restoration cancels the dialog.
              setTimeout(() => setShareOpen(true), 0);
            }}
          >
            <Share2 className="size-4 mr-2" /> Share
          </DropdownMenuItem>
          <DropdownMenuItem onClick={remove} className="text-destructive focus:text-destructive">
            <Trash2 className="size-4 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        target={{ kind: "task", id: task.id, name: task.name }}
      />

      <CompletionDialog
        open={completionOpen}
        onOpenChange={setCompletionOpen}
        taskId={task.id}
        taskName={task.name}
        estimatedMinutes={task.estimatedMinutes}
        estimatedStress={task.stress}
        estimatedExhaustion={task.exhaustion}
      />
    </div>
  );
}
