"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ProjectStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc/client";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { formatDate } from "@/lib/format";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  ACTIVE: "active",
  PAUSED: "paused",
  DONE: "done",
  ARCHIVED: "archived",
};

const STATUS_VARIANT: Record<ProjectStatus, "default" | "secondary" | "outline"> = {
  ACTIVE: "default",
  PAUSED: "outline",
  DONE: "secondary",
  ARCHIVED: "outline",
};

export function ProjectsClient() {
  const [areaFilter, setAreaFilter] = useState<string>("");
  const [newOpen, setNewOpen] = useState(false);
  const { data: areas } = trpc.areas.list.useQuery();
  const { data: projects, isLoading } = trpc.projects.list.useQuery({
    areaId: areaFilter || undefined,
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-2">
          <Label htmlFor="area-filter">Area</Label>
          <select
            id="area-filter"
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">All</option>
            {areas?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="size-4" /> New project
        </Button>
      </div>

      <div className="mt-6 grid gap-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading projects…</p>
        ) : projects && projects.length > 0 ? (
          projects.map((p) => (
            <Card key={p.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <Link
                  href={`/projects/${p.id}`}
                  className="font-medium hover:underline truncate block"
                >
                  {p.name}
                </Link>
                <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                  {p.area ? <Badge variant="outline">{p.area.name}</Badge> : null}
                  <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                  {p.dueDate ? <span>due {formatDate(p.dueDate)}</span> : null}
                  <span>{p._count.tasks} tasks</span>
                </div>
              </div>
            </Card>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        )}
      </div>

      <ProjectFormDialog open={newOpen} onOpenChange={setNewOpen} defaultAreaId={areaFilter || undefined} />
    </>
  );
}
