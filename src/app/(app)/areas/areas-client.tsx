"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc/client";
import { AreaFormDialog } from "@/components/areas/area-form-dialog";
import { RotatingTagline } from "@/components/app/rotating-tagline";

const AREAS_EMPTY = [
  "No areas yet. Greg has 47. Don't be Greg. Maybe four Gregs.",
  "Empty. Even Frank's garage shelves are labeled.",
  "No areas. Patricia would say 'we should organize the photos.' She's right.",
  "Empty. Mike's 'system' would be six areas. Mike doesn't have a system.",
  "No areas. Bertha would just say 'the everything drawer.' It's a vibe.",
];

type Area = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  archived: boolean;
  _count: { projects: number; tasks: number };
};

export function AreasClient() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<Area | null | undefined>(undefined);
  const { data: areas, isLoading } = trpc.areas.list.useQuery({ includeArchived });
  const utils = trpc.useUtils();
  const setArchived = trpc.areas.setArchived.useMutation({
    onSuccess: () => utils.areas.list.invalidate(),
  });
  const del = trpc.areas.delete.useMutation({
    onSuccess: () => utils.areas.list.invalidate(),
  });

  return (
    <>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={includeArchived}
            onCheckedChange={(v) => setIncludeArchived(Boolean(v))}
          />
          <Label className="cursor-pointer">Show archived</Label>
        </label>
        <Button onClick={() => setEditing(null)}>
          <Plus className="size-4" /> New area
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground mt-6">Loading areas…</p>
      ) : areas && areas.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {areas.map((area) => (
            <Card key={area.id} className={area.archived ? "opacity-60" : undefined}>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div className="min-w-0 flex items-start gap-2">
                  {area.color ? (
                    <span
                      className="mt-1 size-3 rounded-full shrink-0"
                      style={{ backgroundColor: area.color }}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <CardTitle className="truncate">{area.name}</CardTitle>
                    {area.description ? (
                      <CardDescription className="line-clamp-2 mt-1">
                        {area.description}
                      </CardDescription>
                    ) : null}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(area)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setArchived.mutate(
                        { id: area.id, archived: !area.archived },
                        {
                          onError: (e) => toast.error(e.message),
                        },
                      )
                    }
                  >
                    {area.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (!confirm(`Delete area "${area.name}"? Projects/tasks in it will be unlinked.`)) return;
                      del.mutate(
                        { id: area.id },
                        { onError: (e) => toast.error(e.message) },
                      );
                    }}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex gap-4 text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">{area._count.projects}</span> projects
                </span>
                <span>
                  <span className="font-medium text-foreground">{area._count.tasks}</span> tasks
                </span>
                {area.archived ? <span className="ml-auto italic">archived</span> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="py-6 text-center grid gap-1.5 mt-2">
          <p className="font-heading text-lg tracking-tight">
            <RotatingTagline taglines={AREAS_EMPTY} />
          </p>
          <p className="text-xs text-muted-foreground">
            Create one to organize your ongoing responsibilities.
          </p>
        </div>
      )}

      <AreaFormDialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        area={editing}
      />
    </>
  );
}
