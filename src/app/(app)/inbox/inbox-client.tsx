"use client";

import { TaskStatus } from "@prisma/client";

import { QuickAdd } from "@/components/tasks/quick-add";
import { TaskListItem } from "@/components/tasks/task-list-item";
import { TaskFormDialog, useTaskDialog } from "@/components/tasks/task-form-dialog";
import { trpc } from "@/lib/trpc/client";
import { RotatingTagline } from "@/components/app/rotating-tagline";

const INBOX_EMPTY = [
  "Empty. Esmeralda's crystal ball is just showing static.",
  "Quiet. Kazimir hasn't logged a single nightmare today.",
  "Nothing yet. Gertrude says even the ghosts have nothing to report.",
  "Empty. Petros's plants are sleeping through their sessions.",
  "No notes. Wendell hasn't cracked a single cookie this morning.",
  "Quiet. Mireille's mer-tax season hasn't opened yet.",
  "Empty. Bartholomew swears today only happens once. He's wrong.",
  "Nothing. Lucinda's Sasquatches cancelled brunch again.",
];

export function InboxClient() {
  const taskDialog = useTaskDialog();
  const { data: tasks, isLoading } = trpc.tasks.list.useQuery({
    status: [TaskStatus.INBOX],
  });

  return (
    <>
      <QuickAdd />

      <div className="mt-6 grid gap-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : tasks && tasks.length > 0 ? (
          tasks.map((t) => (
            <TaskListItem key={t.id} task={t} onClick={(id) => taskDialog.openEdit(id)} />
          ))
        ) : (
          <div className="py-6 text-center grid gap-1.5">
            <p className="font-heading text-lg tracking-tight">
              <RotatingTagline taglines={INBOX_EMPTY} />
            </p>
            <p className="text-xs text-muted-foreground">
              Capture anything that comes to mind above — fill in the details later.
            </p>
          </div>
        )}
      </div>

      <TaskFormDialog
        open={taskDialog.state.open}
        onOpenChange={(open) => (open ? null : taskDialog.close())}
        taskId={taskDialog.state.taskId}
      />
    </>
  );
}
