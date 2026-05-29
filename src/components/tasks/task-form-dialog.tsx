"use client";

import { useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TaskForm, type TaskFormDefaults } from "./task-form";
import { trpc } from "@/lib/trpc/client";

export function TaskFormDialog({
  open,
  onOpenChange,
  taskId,
  defaults,
  lockProjectId,
  lockAreaId,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId?: string;
  defaults?: TaskFormDefaults;
  lockProjectId?: string;
  lockAreaId?: string;
  title?: string;
}) {
  // When editing, load the full task so metric values are present.
  const { data: task } = trpc.tasks.get.useQuery(
    { id: taskId ?? "" },
    { enabled: Boolean(taskId) },
  );

  const initial: TaskFormDefaults | undefined = taskId
    ? task
      ? {
          id: task.id,
          name: task.name,
          description: task.description ?? "",
          status: task.status,
          areaId: task.areaId ?? "",
          projectId: task.projectId ?? "",
          parentTaskId: task.parentTaskId ?? "",
          dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "",
          estimatedMinutes: task.estimatedMinutes ?? "",
          stress: task.stress ?? "",
          valence: task.valence ?? "",
          exhaustion: task.exhaustion ?? "",
          urgency: task.urgency ?? "",
          importance: task.importance ?? "",
          tagIds: task.tags.map((t) => t.tagId),
        }
      : undefined
    : defaults;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title ?? (taskId ? "Edit task" : "New task")}</DialogTitle>
        </DialogHeader>
        {taskId && !task ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <TaskForm
            defaults={initial}
            lockProjectId={lockProjectId}
            lockAreaId={lockAreaId}
            onSaved={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Convenience hook: stable open-state + setter for opening the task dialog. */
export function useTaskDialog() {
  const [state, setState] = useState<{
    open: boolean;
    taskId?: string;
    lockProjectId?: string;
    lockAreaId?: string;
  }>({ open: false });
  return {
    state,
    openNew: (opts?: { lockProjectId?: string; lockAreaId?: string }) =>
      setState({ open: true, ...opts }),
    openEdit: (taskId: string) => setState({ open: true, taskId }),
    close: () => setState((s) => ({ ...s, open: false })),
  };
}
