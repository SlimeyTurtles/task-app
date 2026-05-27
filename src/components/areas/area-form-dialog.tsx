"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc/client";

const Schema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  color: z.string().max(32).optional(),
});
type FormValues = z.infer<typeof Schema>;

export function AreaFormDialog({
  open,
  onOpenChange,
  area,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  area?: { id: string; name: string; description: string | null; color: string | null } | null;
}) {
  const utils = trpc.useUtils();
  const create = trpc.areas.create.useMutation();
  const update = trpc.areas.update.useMutation();

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      name: area?.name ?? "",
      description: area?.description ?? "",
      color: area?.color ?? "",
    },
  });

  useEffect(() => {
    form.reset({
      name: area?.name ?? "",
      description: area?.description ?? "",
      color: area?.color ?? "",
    });
  }, [area, form]);

  async function onSubmit(values: FormValues) {
    try {
      const payload = {
        name: values.name.trim(),
        description: values.description?.trim() || null,
        color: values.color?.trim() || null,
      };
      if (area) {
        await update.mutateAsync({ id: area.id, ...payload });
        toast.success("Area updated.");
      } else {
        await create.mutateAsync(payload);
        toast.success("Area created.");
      }
      await utils.areas.list.invalidate();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save area.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{area ? "Edit area" : "New area"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="area-name">Name</Label>
            <Input id="area-name" autoFocus {...form.register("name")} />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="area-desc">Description</Label>
            <Textarea id="area-desc" rows={3} {...form.register("description")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="area-color">Color (CSS)</Label>
            <Input id="area-color" placeholder="#7c3aed" {...form.register("color")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {area ? "Save changes" : "Create area"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
