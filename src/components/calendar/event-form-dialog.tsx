"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Trash2, X } from "lucide-react";
import { EventKind } from "@prisma/client";

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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc/client";
import { dateToInputValue, inputValueToDate } from "@/lib/format";

function toTimeInputValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function combineDateAndTime(dateStr: string, timeStr: string): Date | null {
  const date = inputValueToDate(dateStr);
  if (!date) return null;
  const [h, m] = timeStr.split(":").map(Number);
  date.setHours(h ?? 0, m ?? 0, 0, 0);
  return date;
}

export type EventDialogState = {
  open: boolean;
  eventId?: string;
  /** Pre-fill values when opening to create a new event. */
  init?: {
    startsAt: Date;
    endsAt: Date;
    kind?: EventKind;
    taskIds?: string[];
    lazy?: boolean;
  };
};

export function EventFormDialog({
  state,
  onClose,
}: {
  state: EventDialogState;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: tasks } = trpc.tasks.list.useQuery({});
  const { data: existing } = trpc.events.get.useQuery(
    { id: state.eventId ?? "" },
    { enabled: Boolean(state.eventId) },
  );

  const [dateStr, setDateStr] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [kind, setKind] = useState<EventKind>(EventKind.ACTIVE);
  const [lazy, setLazy] = useState(false);
  const [notes, setNotes] = useState("");
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [taskFilter, setTaskFilter] = useState("");

  useEffect(() => {
    if (!state.open) return;
    if (state.eventId && existing) {
      setDateStr(dateToInputValue(existing.startsAt));
      setStartTime(toTimeInputValue(existing.startsAt));
      setEndTime(toTimeInputValue(existing.endsAt));
      setKind(existing.kind);
      setLazy(existing.confidence < 1);
      setNotes(existing.notes ?? "");
      setTaskIds(existing.attributions.map((a) => a.taskId));
    } else if (state.init) {
      setDateStr(dateToInputValue(state.init.startsAt));
      setStartTime(toTimeInputValue(state.init.startsAt));
      setEndTime(toTimeInputValue(state.init.endsAt));
      setKind(state.init.kind ?? EventKind.ACTIVE);
      setLazy(state.init.lazy ?? false);
      setNotes("");
      setTaskIds(state.init.taskIds ?? []);
    }
  }, [state.open, state.eventId, existing, state.init]);

  const create = trpc.events.create.useMutation();
  const update = trpc.events.update.useMutation();
  const del = trpc.events.delete.useMutation();

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    const q = taskFilter.trim().toLowerCase();
    return q ? tasks.filter((t) => t.name.toLowerCase().includes(q)) : tasks;
  }, [tasks, taskFilter]);
  const tasksById = useMemo(() => new Map(tasks?.map((t) => [t.id, t]) ?? []), [tasks]);

  async function onSave() {
    const startsAt = combineDateAndTime(dateStr, startTime);
    const endsAt = combineDateAndTime(dateStr, endTime);
    if (!startsAt || !endsAt) {
      toast.error("Pick a valid date and time.");
      return;
    }
    if (endsAt <= startsAt) {
      toast.error("End time must be after start time.");
      return;
    }

    try {
      const payload = {
        startsAt,
        endsAt,
        notes: notes.trim() || null,
        kind,
        lazy,
        attributions: taskIds.map((id) => ({ taskId: id, weight: 1, ratioUnknown: false })),
      };
      if (state.eventId) {
        await update.mutateAsync({ id: state.eventId, ...payload });
        toast.success("Event updated.");
      } else {
        await create.mutateAsync(payload);
        toast.success("Event logged.");
      }
      await utils.events.list.invalidate();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save event.");
    }
  }

  async function onDelete() {
    if (!state.eventId) return;
    if (!confirm("Delete this event?")) return;
    try {
      await del.mutateAsync({ id: state.eventId });
      await utils.events.list.invalidate();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete event.");
    }
  }

  function toggleTask(id: string) {
    setTaskIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {state.eventId ? "Edit event" : kind === EventKind.BACKGROUND ? "New time block" : "Log event"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="event-date">Date</Label>
              <Input
                id="event-date"
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="event-start">Start</Label>
              <Input
                id="event-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="event-end">End</Label>
              <Input
                id="event-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="event-kind">Kind</Label>
              <select
                id="event-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as EventKind)}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              >
                <option value={EventKind.ACTIVE}>Active</option>
                <option value={EventKind.BACKGROUND}>Background (sleep / work hours / commute)</option>
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={lazy} onCheckedChange={(v) => setLazy(Boolean(v))} />
                <span>Lazy log (low confidence)</span>
              </label>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="event-notes">Notes</Label>
            <Textarea
              id="event-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Tasks ({taskIds.length} attributed)</Label>
              {taskIds.length > 1 ? (
                <Badge variant="outline">parallel — ratio unknown</Badge>
              ) : null}
            </div>
            {taskIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {taskIds.map((id) => {
                  const t = tasksById.get(id);
                  return (
                    <Badge key={id} variant="secondary" className="gap-1">
                      {t?.name ?? id}
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => toggleTask(id)}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            ) : null}
            <Input
              placeholder="Search tasks to attribute…"
              value={taskFilter}
              onChange={(e) => setTaskFilter(e.target.value)}
            />
            <div className="max-h-40 overflow-y-auto border rounded-md divide-y">
              {filteredTasks.slice(0, 50).map((t) => {
                const on = taskIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTask(t.id)}
                    className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-accent/40 ${on ? "bg-accent/40" : ""}`}
                  >
                    <Checkbox checked={on} />
                    <span className="truncate flex-1">{t.name}</span>
                    {t.project ? (
                      <span className="text-xs text-muted-foreground">{t.project.name}</span>
                    ) : null}
                  </button>
                );
              })}
              {filteredTasks.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">No tasks.</p>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="justify-between">
          <div>
            {state.eventId ? (
              <Button variant="ghost" size="sm" onClick={onDelete}>
                <Trash2 className="size-4" /> Delete
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={onSave}>
              {state.eventId ? "Save changes" : "Log event"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
