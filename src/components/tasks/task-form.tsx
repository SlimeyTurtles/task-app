"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TaskStatus } from "@prisma/client";
import { z } from "zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { TagPicker } from "./tag-picker";
import { trpc } from "@/lib/trpc/client";
import { dateToInputValue, inputValueToDate } from "@/lib/format";

const Schema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(300),
  description: z.string().max(10_000).optional(),
  status: z.nativeEnum(TaskStatus),
  areaId: z.string().optional(),
  projectId: z.string().optional(),
  parentTaskId: z.string().optional(),
  dueDate: z.string().optional(),
  estimatedMinutes: z.union([z.string(), z.number()]).optional(),
  stress: z.union([z.string(), z.number()]).optional(),
  valence: z.union([z.string(), z.number()]).optional(),
  exhaustion: z.union([z.string(), z.number()]).optional(),
  urgency: z.union([z.string(), z.number()]).optional(),
  importance: z.union([z.string(), z.number()]).optional(),
  tagIds: z.array(z.string()).optional(),
});
type FormValues = z.infer<typeof Schema>;

export type TaskFormDefaults = Partial<FormValues> & { id?: string };

export function TaskForm({
  defaults,
  lockProjectId,
  lockAreaId,
  onSaved,
  onCancel,
}: {
  defaults?: TaskFormDefaults;
  /** Pre-set and disable the project field, e.g. when creating from a project's detail page. */
  lockProjectId?: string;
  lockAreaId?: string;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: areas } = trpc.areas.list.useQuery();
  const { data: projects } = trpc.projects.list.useQuery();

  const isEditing = Boolean(defaults?.id);

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      name: defaults?.name ?? "",
      description: defaults?.description ?? "",
      status: defaults?.status ?? TaskStatus.INBOX,
      areaId: lockAreaId ?? defaults?.areaId ?? "",
      projectId: lockProjectId ?? defaults?.projectId ?? "",
      parentTaskId: defaults?.parentTaskId ?? "",
      dueDate: defaults?.dueDate ?? "",
      estimatedMinutes: defaults?.estimatedMinutes ?? "",
      stress: defaults?.stress ?? "",
      valence: defaults?.valence ?? "",
      exhaustion: defaults?.exhaustion ?? "",
      urgency: defaults?.urgency ?? "",
      importance: defaults?.importance ?? "",
      tagIds: defaults?.tagIds ?? [],
    },
  });

  // Keep area defaulting to the project's area when a project is picked.
  const projectId = form.watch("projectId");
  useEffect(() => {
    if (!projectId) return;
    const proj = projects?.find((p) => p.id === projectId);
    if (proj?.area && !form.getValues("areaId")) {
      form.setValue("areaId", proj.area.id);
    }
  }, [projectId, projects, form]);

  const create = trpc.tasks.create.useMutation();
  const update = trpc.tasks.update.useMutation();

  async function onSubmit(values: FormValues) {
    const payload = {
      name: values.name.trim(),
      description: values.description?.trim() || null,
      status: values.status,
      areaId: values.areaId || null,
      projectId: values.projectId || null,
      parentTaskId: values.parentTaskId || null,
      dueDate: values.dueDate ? inputValueToDate(values.dueDate) : null,
      estimatedMinutes: toIntOrNull(values.estimatedMinutes),
      stress: toIntOrNull(values.stress),
      valence: toIntOrNull(values.valence),
      exhaustion: toIntOrNull(values.exhaustion),
      urgency: toIntOrNull(values.urgency),
      importance: toIntOrNull(values.importance),
      tagIds: values.tagIds ?? [],
    };

    try {
      if (isEditing && defaults?.id) {
        await update.mutateAsync({ id: defaults.id, ...payload });
        toast.success("Task updated.");
      } else {
        await create.mutateAsync(payload);
        toast.success("Task created.");
      }
      await Promise.all([utils.tasks.list.invalidate(), utils.tasks.get.invalidate()]);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save task.");
    }
  }

  const projectsForArea = areas && projects
    ? projects.filter((p) => !form.watch("areaId") || p.areaId === form.watch("areaId") || !p.areaId)
    : projects;

  const busy = form.formState.isSubmitting || create.isPending || update.isPending;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="task-name">Name</Label>
        <Input id="task-name" autoFocus {...form.register("name")} />
        {form.formState.errors.name ? (
          <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="task-desc">Description</Label>
        <Textarea id="task-desc" rows={3} {...form.register("description")} />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <SelectField label="Area" {...form.register("areaId")} disabled={Boolean(lockAreaId)}>
          <option value="">— None —</option>
          {areas?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </SelectField>

        <SelectField label="Project" {...form.register("projectId")} disabled={Boolean(lockProjectId)}>
          <option value="">— None —</option>
          {projectsForArea?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>

        <SelectField label="Status" {...form.register("status")}>
          {Object.values(TaskStatus).map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase().replace("_", " ")}
            </option>
          ))}
        </SelectField>

        <div className="grid gap-2">
          <Label htmlFor="task-due">Due date</Label>
          <Input id="task-due" type="date" {...form.register("dueDate")} />
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Tags</Label>
        <Controller
          control={form.control}
          name="tagIds"
          render={({ field }) => <TagPicker value={field.value ?? []} onChange={field.onChange} />}
        />
      </div>

      <Separator />

      <div className="grid sm:grid-cols-3 gap-3">
        <NumberField label="Estimated minutes" min={0} {...form.register("estimatedMinutes")} />
        <NumberField label="Stress (0–10)" min={0} max={10} {...form.register("stress")} />
        <NumberField label="Exhaustion (0–10)" min={0} max={10} {...form.register("exhaustion")} />
        <NumberField label="Valence (−5 to +5)" min={-5} max={5} {...form.register("valence")} />
        <NumberField label="Urgency (0–10)" min={0} max={10} {...form.register("urgency")} />
        <NumberField label="Importance (0–10)" min={0} max={10} {...form.register("importance")} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : isEditing ? "Save changes" : "Create task"}
        </Button>
      </div>
    </form>
  );
}

function SelectField({
  label,
  children,
  disabled,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = `task-form-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        {...rest}
        disabled={disabled}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {children}
      </select>
    </div>
  );
}

function NumberField({
  label,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = `task-form-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="numeric" {...rest} />
    </div>
  );
}

function toIntOrNull(v: string | number | undefined): number | null {
  if (v === "" || v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
