"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ProjectStatus } from "@prisma/client";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc/client";
import { dateToInputValue, inputValueToDate } from "@/lib/format";

const Schema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  definitionOfDone: z.string().max(5000).optional(),
  areaId: z.string().optional(),
  status: z.nativeEnum(ProjectStatus),
  dueDate: z.string().optional(),
});
type FormValues = z.infer<typeof Schema>;

export type ProjectInit = {
  id?: string;
  name?: string;
  description?: string | null;
  definitionOfDone?: string | null;
  areaId?: string | null;
  status?: ProjectStatus;
  dueDate?: Date | string | null;
};

export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  defaultAreaId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: ProjectInit | null;
  defaultAreaId?: string;
}) {
  const utils = trpc.useUtils();
  const { data: areas } = trpc.areas.list.useQuery();
  const create = trpc.projects.create.useMutation();
  const update = trpc.projects.update.useMutation();

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      name: project?.name ?? "",
      description: project?.description ?? "",
      definitionOfDone: project?.definitionOfDone ?? "",
      areaId: project?.areaId ?? defaultAreaId ?? "",
      status: project?.status ?? ProjectStatus.ACTIVE,
      dueDate: project?.dueDate ? dateToInputValue(project.dueDate) : "",
    },
  });

  useEffect(() => {
    form.reset({
      name: project?.name ?? "",
      description: project?.description ?? "",
      definitionOfDone: project?.definitionOfDone ?? "",
      areaId: project?.areaId ?? defaultAreaId ?? "",
      status: project?.status ?? ProjectStatus.ACTIVE,
      dueDate: project?.dueDate ? dateToInputValue(project.dueDate) : "",
    });
  }, [project, defaultAreaId, form]);

  async function onSubmit(values: FormValues) {
    const payload = {
      name: values.name.trim(),
      description: values.description?.trim() || null,
      definitionOfDone: values.definitionOfDone?.trim() || null,
      areaId: values.areaId || null,
      status: values.status,
      dueDate: values.dueDate ? inputValueToDate(values.dueDate) : null,
    };
    try {
      if (project?.id) {
        await update.mutateAsync({ id: project.id, ...payload });
        toast.success("Project updated.");
      } else {
        await create.mutateAsync(payload);
        toast.success("Project created.");
      }
      await Promise.all([utils.projects.list.invalidate(), utils.projects.get.invalidate()]);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save project.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{project?.id ? "Edit project" : "New project"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" autoFocus {...form.register("name")} />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="project-desc">Description</Label>
            <Textarea id="project-desc" rows={2} {...form.register("description")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="project-dod">Definition of done</Label>
            <Textarea id="project-dod" rows={2} {...form.register("definitionOfDone")} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="project-area">Area</Label>
              <select
                id="project-area"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                {...form.register("areaId")}
              >
                <option value="">— None —</option>
                {areas?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-status">Status</Label>
              <select
                id="project-status"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                {...form.register("status")}
              >
                {Object.values(ProjectStatus).map((s) => (
                  <option key={s} value={s}>
                    {s.toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="project-due">Due date</Label>
            <Input id="project-due" type="date" {...form.register("dueDate")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {project?.id ? "Save changes" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
