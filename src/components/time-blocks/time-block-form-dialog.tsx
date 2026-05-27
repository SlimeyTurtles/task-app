"use client";

import { useEffect, useState } from "react";
import { TimeBlockKind } from "@prisma/client";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { dateToInputValue, inputValueToDate } from "@/lib/format";

function toTime(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function combine(dateStr: string, time: string): Date | null {
  const d = inputValueToDate(dateStr);
  if (!d) return null;
  const [h, m] = time.split(":").map(Number);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

export type TimeBlockInit = {
  id?: string;
  startsAt?: Date;
  endsAt?: Date;
  kind?: TimeBlockKind;
  label?: string | null;
  schedulableOnTop?: boolean;
};

export function TimeBlockFormDialog({
  open,
  onOpenChange,
  block,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  block?: TimeBlockInit | null;
}) {
  const utils = trpc.useUtils();
  const create = trpc.timeBlocks.create.useMutation();
  const update = trpc.timeBlocks.update.useMutation();
  const del = trpc.timeBlocks.delete.useMutation();

  const today = new Date();
  const [dateStr, setDateStr] = useState(() => dateToInputValue(today));
  const [startTime, setStartTime] = useState("22:00");
  const [endDateStr, setEndDateStr] = useState(() => dateToInputValue(today));
  const [endTime, setEndTime] = useState("23:30");
  const [kind, setKind] = useState<TimeBlockKind>(TimeBlockKind.CUSTOM);
  const [label, setLabel] = useState("");
  const [schedulable, setSchedulable] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (block?.startsAt) {
      setDateStr(dateToInputValue(block.startsAt));
      setStartTime(toTime(block.startsAt));
    }
    if (block?.endsAt) {
      setEndDateStr(dateToInputValue(block.endsAt));
      setEndTime(toTime(block.endsAt));
    }
    setKind(block?.kind ?? TimeBlockKind.CUSTOM);
    setLabel(block?.label ?? "");
    setSchedulable(block?.schedulableOnTop ?? false);
  }, [open, block]);

  async function save() {
    const startsAt = combine(dateStr, startTime);
    const endsAt = combine(endDateStr, endTime);
    if (!startsAt || !endsAt) {
      toast.error("Pick a valid date and time.");
      return;
    }
    if (endsAt <= startsAt) {
      toast.error("End must be after start.");
      return;
    }
    try {
      const payload = {
        startsAt,
        endsAt,
        kind,
        label: label.trim() || null,
        schedulableOnTop: schedulable,
      };
      if (block?.id) {
        await update.mutateAsync({ id: block.id, ...payload });
        toast.success("Time block updated.");
      } else {
        await create.mutateAsync(payload);
        toast.success("Time block created.");
      }
      await utils.timeBlocks.list.invalidate();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save time block.");
    }
  }

  async function onDelete() {
    if (!block?.id) return;
    if (!confirm("Delete this time block?")) return;
    try {
      await del.mutateAsync({ id: block.id });
      await utils.timeBlocks.list.invalidate();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{block?.id ? "Edit time block" : "New time block"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="tb-start-date">Start date</Label>
              <Input
                id="tb-start-date"
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tb-start-time">Start time</Label>
              <Input
                id="tb-start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tb-end-date">End date</Label>
              <Input
                id="tb-end-date"
                type="date"
                value={endDateStr}
                onChange={(e) => setEndDateStr(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tb-end-time">End time</Label>
              <Input
                id="tb-end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="tb-kind">Kind</Label>
              <select
                id="tb-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as TimeBlockKind)}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              >
                {Object.values(TimeBlockKind).map((k) => (
                  <option key={k} value={k}>
                    {k.toLowerCase().replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tb-label">Label</Label>
              <Input
                id="tb-label"
                placeholder="e.g. Sleep, Morning commute"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={schedulable}
              onCheckedChange={(v) => setSchedulable(Boolean(v))}
            />
            <span>Schedulable on top (scheduler may overlay events here anyway)</span>
          </label>
        </div>
        <DialogFooter className="justify-between">
          <div>
            {block?.id ? (
              <Button variant="ghost" size="sm" onClick={onDelete}>
                <Trash2 className="size-4" /> Delete
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save}>{block?.id ? "Save" : "Create"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Trash2 import used only when editing; declared here to keep import block tidy.
import { Trash2 } from "lucide-react";
