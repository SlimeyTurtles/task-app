"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc/client";
import { REPEAT_OPTIONS, type Repeat, repeatToRrule, rruleToRepeat } from "@/lib/recurrence";

type Rule = {
  taskId: string;
  rrule: string;
  timezone: string;
};

export function EditRruleDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [raw, setRaw] = useState("");
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    if (!rule) return;
    setRepeat(rruleToRepeat(rule.rrule));
    setRaw(rule.rrule);
    setTimezone(rule.timezone);
  }, [rule]);

  const upsert = trpc.recurrence.upsert.useMutation({
    onSuccess: async () => {
      await utils.recurrence.list.invalidate();
      toast.success("Recurrence updated.");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function onChooseCommon(next: Repeat) {
    setRepeat(next);
    const r = repeatToRrule(next);
    if (r) setRaw(r);
  }

  async function onSave() {
    if (!rule) return;
    if (!raw.trim()) {
      toast.error("Provide an RRULE.");
      return;
    }
    upsert.mutate({ taskId: rule.taskId, rrule: raw.trim(), timezone: timezone.trim() || "UTC" });
  }

  return (
    <Dialog open={rule != null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit recurrence</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Common pattern</Label>
            <select
              value={repeat}
              onChange={(e) => onChooseCommon(e.target.value as Repeat)}
              className="h-10 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {REPEAT_OPTIONS.filter((o) => o.value !== "none").map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rrule-raw" className="text-xs text-muted-foreground">Raw RRULE</Label>
            <Input
              id="rrule-raw"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              iCal RRULE without the <code>RRULE:</code> prefix.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rrule-tz" className="text-xs text-muted-foreground">Timezone</Label>
            <Input
              id="rrule-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="UTC"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={upsert.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
