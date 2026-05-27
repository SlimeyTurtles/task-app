"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc/client";

export function QuickAdd({ onAdded }: { onAdded?: (taskId: string) => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const create = trpc.tasks.quickCapture.useMutation({
    onSuccess: (task) => {
      setName("");
      void utils.tasks.list.invalidate();
      onAdded?.(task.id);
    },
    onError: (err) => toast.error(err.message),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate({ name: trimmed });
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        autoFocus
        placeholder="Capture a task and press Enter…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={create.isPending}
      />
      <Button type="submit" disabled={!name.trim() || create.isPending}>
        <Plus className="size-4" />
        Add
      </Button>
    </form>
  );
}
