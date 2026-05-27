"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { TaskStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TaskListItem } from "@/components/tasks/task-list-item";
import { TaskFormDialog, useTaskDialog } from "@/components/tasks/task-form-dialog";
import { trpc } from "@/lib/trpc/client";
import { inputValueToDate } from "@/lib/format";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: TaskStatus.INBOX, label: "Inbox" },
  { value: TaskStatus.SCHEDULED, label: "Scheduled" },
  { value: TaskStatus.IN_PROGRESS, label: "In progress" },
  { value: TaskStatus.DONE, label: "Done" },
  { value: TaskStatus.DROPPED, label: "Dropped" },
];

export function AllTasksClient() {
  const taskDialog = useTaskDialog();
  const [statuses, setStatuses] = useState<TaskStatus[]>([
    TaskStatus.INBOX,
    TaskStatus.SCHEDULED,
    TaskStatus.IN_PROGRESS,
  ]);
  const [areaId, setAreaId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [tagId, setTagId] = useState<string>("");
  const [dueBefore, setDueBefore] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const { data: areas } = trpc.areas.list.useQuery();
  const { data: projects } = trpc.projects.list.useQuery();
  const { data: tags } = trpc.tags.list.useQuery();
  const { data: tasks, isLoading } = trpc.tasks.list.useQuery({
    status: statuses,
    areaId: areaId || undefined,
    projectId: projectId || undefined,
    tagId: tagId || undefined,
    dueBefore: dueBefore ? inputValueToDate(dueBefore) ?? undefined : undefined,
    search: search.trim() || undefined,
  });

  function toggleStatus(s: TaskStatus) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label>Status</Label>
          <div className="flex flex-wrap gap-1">
            {STATUS_OPTIONS.map((opt) => {
              const on = statuses.includes(opt.value);
              return (
                <Button
                  key={opt.value}
                  type="button"
                  variant={on ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleStatus(opt.value)}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>
        </div>

        <FilterSelect label="Area" value={areaId} onChange={setAreaId}>
          <option value="">All</option>
          {areas?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect label="Project" value={projectId} onChange={setProjectId}>
          <option value="">All</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect label="Tag" value={tagId} onChange={setTagId}>
          <option value="">All</option>
          {tags?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </FilterSelect>

        <div className="grid gap-2">
          <Label htmlFor="due-before">Due by</Label>
          <Input
            id="due-before"
            type="date"
            value={dueBefore}
            onChange={(e) => setDueBefore(e.target.value)}
            className="h-9"
          />
        </div>

        <div className="grid gap-2 flex-1 min-w-[16rem]">
          <Label htmlFor="search">Search</Label>
          <Input
            id="search"
            placeholder="Filter by name or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9"
          />
        </div>

        <Button onClick={() => taskDialog.openNew()}>
          <Plus className="size-4" /> New task
        </Button>
      </div>

      <div className="mt-6 grid gap-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading tasks…</p>
        ) : tasks && tasks.length > 0 ? (
          tasks.map((t) => (
            <TaskListItem key={t.id} task={t} onClick={(id) => taskDialog.openEdit(id)} />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No tasks match the current filters.</p>
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

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
      >
        {children}
      </select>
    </div>
  );
}
