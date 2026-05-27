"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { ProjectStatus, TaskStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { TaskFormDialog, useTaskDialog } from "@/components/tasks/task-form-dialog";
import { TaskListItem } from "@/components/tasks/task-list-item";
import { formatDate } from "@/lib/format";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  ACTIVE: "active",
  PAUSED: "paused",
  DONE: "done",
  ARCHIVED: "archived",
};

export function ProjectDetailClient({ id }: { id: string }) {
  const { data: project, isLoading } = trpc.projects.get.useQuery({ id });
  const { data: tasks } = trpc.tasks.list.useQuery({ projectId: id });
  const [editOpen, setEditOpen] = useState(false);
  const taskDialog = useTaskDialog();

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!project) return <p className="text-sm text-muted-foreground">Project not found.</p>;

  const openTasks = tasks?.filter(
    (t) => t.status !== TaskStatus.DONE && t.status !== TaskStatus.DROPPED,
  );
  const closedTasks = tasks?.filter(
    (t) => t.status === TaskStatus.DONE || t.status === TaskStatus.DROPPED,
  );

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <Badge variant="outline">{STATUS_LABEL[project.status]}</Badge>
            {project.area ? <Badge variant="secondary">{project.area.name}</Badge> : null}
          </div>
          {project.description ? (
            <p className="text-muted-foreground mt-2">{project.description}</p>
          ) : null}
          {project.dueDate ? (
            <p className="text-xs text-muted-foreground mt-2">Due {formatDate(project.dueDate)}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" /> Edit
          </Button>
          <Button onClick={() => taskDialog.openNew({ lockProjectId: id })}>
            <Plus className="size-4" /> New task
          </Button>
        </div>
      </div>

      {project.definitionOfDone ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Definition of done</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">{project.definitionOfDone}</CardContent>
        </Card>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Open tasks {openTasks ? `(${openTasks.length})` : ""}
        </h2>
        <div className="grid gap-2">
          {openTasks?.length ? (
            openTasks.map((t) => (
              <TaskListItem key={t.id} task={t} onClick={(id) => taskDialog.openEdit(id)} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No open tasks yet.</p>
          )}
        </div>
      </section>

      {closedTasks && closedTasks.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Closed ({closedTasks.length})
          </h2>
          <div className="grid gap-2">
            {closedTasks.map((t) => (
              <TaskListItem key={t.id} task={t} onClick={(id) => taskDialog.openEdit(id)} />
            ))}
          </div>
        </section>
      ) : null}

      <ProjectFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        project={{
          id: project.id,
          name: project.name,
          description: project.description,
          definitionOfDone: project.definitionOfDone,
          areaId: project.areaId,
          status: project.status,
          dueDate: project.dueDate,
        }}
      />

      <TaskFormDialog
        open={taskDialog.state.open}
        onOpenChange={(open) => (open ? null : taskDialog.close())}
        taskId={taskDialog.state.taskId}
        lockProjectId={taskDialog.state.lockProjectId}
      />
    </>
  );
}
