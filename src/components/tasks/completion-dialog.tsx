"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc/client";

export function CompletionDialog({
  open,
  onOpenChange,
  taskId,
  estimatedMinutes,
  estimatedStress,
  estimatedExhaustion,
  taskName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  estimatedMinutes?: number | null;
  estimatedStress?: number | null;
  estimatedExhaustion?: number | null;
  taskName: string;
}) {
  const utils = trpc.useUtils();
  const markComplete = trpc.tasks.markComplete.useMutation();

  const [actualMinutes, setActualMinutes] = useState<string>("");
  const [actualStress, setActualStress] = useState<string>("");
  const [actualExhaustion, setActualExhaustion] = useState<string>("");
  const [actualValence, setActualValence] = useState<string>("");
  const [retroNotes, setRetroNotes] = useState<string>("");

  // Pre-fill with the estimates when opening so 1-click confirms "as estimated".
  useEffect(() => {
    if (!open) return;
    setActualMinutes(estimatedMinutes != null ? String(estimatedMinutes) : "");
    setActualStress(estimatedStress != null ? String(estimatedStress) : "");
    setActualExhaustion(estimatedExhaustion != null ? String(estimatedExhaustion) : "");
    setActualValence("");
    setRetroNotes("");
  }, [open, estimatedMinutes, estimatedStress, estimatedExhaustion]);

  async function submit(opts?: { skipMetrics?: boolean }) {
    try {
      await markComplete.mutateAsync({
        id: taskId,
        actualMinutes: opts?.skipMetrics ? null : toIntOrNull(actualMinutes),
        actualStress: opts?.skipMetrics ? null : toIntOrNull(actualStress),
        actualExhaustion: opts?.skipMetrics ? null : toIntOrNull(actualExhaustion),
        actualValence: opts?.skipMetrics ? null : toIntOrNull(actualValence),
        retroNotes: opts?.skipMetrics ? null : retroNotes.trim() || null,
      });
      toast.success("Marked done.");
      await Promise.all([
        utils.tasks.list.invalidate(),
        utils.tasks.get.invalidate(),
      ]);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark complete.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How did it go?</DialogTitle>
          <DialogDescription>
            Optionally rate the real cost of <span className="font-medium">{taskName}</span> so the
            scheduler learns. Hit &quot;Skip&quot; if you don&apos;t want to record it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <NumberField
            label="Actual minutes"
            id="completion-minutes"
            value={actualMinutes}
            onChange={setActualMinutes}
            min={0}
            placeholder={estimatedMinutes != null ? `est ${estimatedMinutes}` : "—"}
          />
          <NumberField
            label="Actual stress (0–10)"
            id="completion-stress"
            value={actualStress}
            onChange={setActualStress}
            min={0}
            max={10}
            placeholder={estimatedStress != null ? `est ${estimatedStress}` : "—"}
          />
          <NumberField
            label="Actual exhaustion (0–10)"
            id="completion-exh"
            value={actualExhaustion}
            onChange={setActualExhaustion}
            min={0}
            max={10}
            placeholder={estimatedExhaustion != null ? `est ${estimatedExhaustion}` : "—"}
          />
          <NumberField
            label="Felt (−5 to +5)"
            id="completion-valence"
            value={actualValence}
            onChange={setActualValence}
            min={-5}
            max={5}
            placeholder="−5..+5"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="completion-notes">Notes</Label>
          <Textarea
            id="completion-notes"
            rows={2}
            value={retroNotes}
            onChange={(e) => setRetroNotes(e.target.value)}
            placeholder="What went well / surprised you?"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => submit({ skipMetrics: true })} disabled={markComplete.isPending}>
            Skip
          </Button>
          <Button onClick={() => submit()} disabled={markComplete.isPending}>
            {markComplete.isPending ? "Saving…" : "Mark done & save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function toIntOrNull(v: string): number | null {
  if (v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
