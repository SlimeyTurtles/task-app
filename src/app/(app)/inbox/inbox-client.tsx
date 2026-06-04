"use client";

import { TaskStatus } from "@prisma/client";

import { QuickAdd } from "@/components/tasks/quick-add";
import { TaskListItem } from "@/components/tasks/task-list-item";
import { TaskFormDialog, useTaskDialog } from "@/components/tasks/task-form-dialog";
import { trpc } from "@/lib/trpc/client";
import { RotatingTagline } from "@/components/app/rotating-tagline";

const INBOX_EMPTY = [
  "Empty. Bertha hasn't called to dictate her grocery list yet.",
  "Quiet in here. Carol from accounting still owes you a follow-up.",
  "Nothing yet. Even Greg's Excel sheets are at zero today.",
  "Empty. Your aunt's brain hasn't kicked in yet — give it coffee.",
  "No notes. Carlos won't shut up about his Moleskine but he hasn't sent any.",
  "Empty. Dave from HR thinks this is alarming. He's wrong about most things.",
  "Nothing. Even Karen hasn't texted you at 11 PM yet.",
  "Quiet. The mental tab where you keep your to-dos finally closed.",
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
