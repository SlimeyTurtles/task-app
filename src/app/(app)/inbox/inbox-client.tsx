"use client";

import { TaskStatus } from "@prisma/client";

import { QuickAdd } from "@/components/tasks/quick-add";
import { TaskListItem } from "@/components/tasks/task-list-item";
import { TaskFormDialog, useTaskDialog } from "@/components/tasks/task-form-dialog";
import { trpc } from "@/lib/trpc/client";

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
          <p className="text-sm text-muted-foreground">
            Your inbox is empty. Capture anything that comes to mind above — fill in the details later.
          </p>
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
