"use client";

import { SharePermission, TaskStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TaskListItem, type TaskListItemTask } from "@/components/tasks/task-list-item";
import { TaskFormDialog, useTaskDialog } from "@/components/tasks/task-form-dialog";
import { trpc } from "@/lib/trpc/client";

export function SharedClient() {
  const taskDialog = useTaskDialog();
  const { data: sharedTasks, isLoading } = trpc.sharing.sharedTasks.useQuery();
  const { data: inbound } = trpc.sharing.listInbound.useQuery();

  const sharedTags = inbound?.tagShares ?? [];

  return (
    <>
      {sharedTags.length > 0 ? (
        <section className="mb-8">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Tags shared with me
          </h2>
          <div className="flex flex-wrap gap-2">
            {sharedTags.map((s) => (
              <Card key={s.id} className="px-3 py-2 flex items-center gap-2">
                <span className="text-sm font-medium">{s.tag.name}</span>
                <Badge variant={s.permission === SharePermission.WRITE ? "default" : "secondary"}>
                  {s.permission === SharePermission.WRITE ? "read & write" : "read only"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  from {s.owner.name ?? s.owner.email}
                </span>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Tasks shared with me
        </h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !sharedTasks || sharedTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing shared with you yet. When someone shares a task or tag, it shows up here —
            segregated from your own data.
          </p>
        ) : (
          <div className="grid gap-2">
            {sharedTasks.map((t) => {
              const canWrite = t.sharePermission === SharePermission.WRITE;
              const item: TaskListItemTask = {
                id: t.id,
                name: t.name,
                status: t.status as TaskStatus,
                dueDate: t.dueDate,
                stress: t.stress,
                exhaustion: t.exhaustion,
                estimatedMinutes: t.estimatedMinutes,
                area: t.area,
                project: t.project,
                tags: t.tags,
                _count: t._count,
              };
              return (
                <div key={t.id} className="flex items-stretch gap-2">
                  <div className="flex-1 min-w-0">
                    {canWrite ? (
                      <TaskListItem task={item} onClick={(id) => taskDialog.openEdit(id)} />
                    ) : (
                      <ReadOnlyTaskRow task={item} owner={t.user.name ?? t.user.email} />
                    )}
                  </div>
                  <div className="flex items-center">
                    <Badge variant={canWrite ? "default" : "secondary"}>
                      {canWrite ? "write" : "read"} · {t.user.name ?? t.user.email}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <TaskFormDialog
        open={taskDialog.state.open}
        onOpenChange={(open) => (open ? null : taskDialog.close())}
        taskId={taskDialog.state.taskId}
      />
    </>
  );
}

function ReadOnlyTaskRow({ task, owner }: { task: TaskListItemTask; owner: string }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2 rounded-md border bg-card">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{task.name}</div>
        <div className="flex flex-wrap gap-1.5 mt-1 items-center text-xs text-muted-foreground">
          {task.project ? <Badge variant="outline">{task.project.name}</Badge> : null}
          {task.tags.map(({ tag }) => (
            <Badge key={tag.id} variant="secondary">
              {tag.name}
            </Badge>
          ))}
          {task.estimatedMinutes ? <span>{task.estimatedMinutes}m</span> : null}
          <span className="italic">owned by {owner}</span>
        </div>
      </div>
    </div>
  );
}
