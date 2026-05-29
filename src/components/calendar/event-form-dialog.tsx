"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Search, Trash2, X } from "lucide-react";
import { EventKind } from "@prisma/client";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { dateToInputValue, inputValueToDate } from "@/lib/format";

function toTimeInputValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function combine(dateStr: string, timeStr: string): Date | null {
  const date = inputValueToDate(dateStr);
  if (!date) return null;
  const [h, m] = timeStr.split(":").map(Number);
  date.setHours(h ?? 0, m ?? 0, 0, 0);
  return date;
}
function durationLabel(start: Date | null, end: Date | null): string {
  if (!start || !end || end <= start) return "";
  const mins = Math.round((end.getTime() - start.getTime()) / 60_000);
  const days = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(" ") || "0m";
}

export type EventDialogState = {
  open: boolean;
  eventId?: string;
  init?: {
    startsAt: Date;
    endsAt: Date;
    kind?: EventKind;
    taskIds?: string[];
    lazy?: boolean;
  };
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function EventFormDialog({ state, onClose }: { state: EventDialogState; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: tasks } = trpc.tasks.list.useQuery({});
  const { data: existing } = trpc.events.get.useQuery(
    { id: state.eventId ?? "" },
    { enabled: Boolean(state.eventId) },
  );

  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("10:00");
  const [kind, setKind] = useState<EventKind>(EventKind.ACTIVE);
  const [lazy, setLazy] = useState(false);
  const [notes, setNotes] = useState("");
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [taskFilter, setTaskFilter] = useState("");

  useEffect(() => {
    if (!state.open) return;
    if (state.eventId && existing) {
      setStartDate(dateToInputValue(existing.startsAt));
      setStartTime(toTimeInputValue(existing.startsAt));
      setEndDate(dateToInputValue(existing.endsAt));
      setEndTime(toTimeInputValue(existing.endsAt));
      setKind(existing.kind);
      setLazy(existing.confidence < 1);
      setNotes(existing.notes ?? "");
      setTaskIds(existing.attributions.map((a) => a.taskId));
      setTaskFilter("");
    } else if (state.init) {
      setStartDate(dateToInputValue(state.init.startsAt));
      setStartTime(toTimeInputValue(state.init.startsAt));
      setEndDate(dateToInputValue(state.init.endsAt));
      setEndTime(toTimeInputValue(state.init.endsAt));
      setKind(state.init.kind ?? EventKind.ACTIVE);
      setLazy(state.init.lazy ?? false);
      setNotes("");
      setTaskIds(state.init.taskIds ?? []);
      setTaskFilter("");
    }
  }, [state.open, state.eventId, existing, state.init]);

  const create = trpc.events.create.useMutation();
  const update = trpc.events.update.useMutation();
  const del = trpc.events.delete.useMutation();
  const pending = create.isPending || update.isPending;

  const startAt = combine(startDate, startTime);
  const endAt = combine(endDate, endTime);
  const dur = durationLabel(startAt, endAt);

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    const q = taskFilter.trim().toLowerCase();
    return q ? tasks.filter((t) => t.name.toLowerCase().includes(q)) : tasks;
  }, [tasks, taskFilter]);
  const tasksById = useMemo(() => new Map(tasks?.map((t) => [t.id, t]) ?? []), [tasks]);

  function toggleTask(id: string) {
    setTaskIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onSave() {
    if (!startAt || !endAt) {
      toast.error("Pick a valid start and end.");
      return;
    }
    if (endAt <= startAt) {
      toast.error("End must be after start.");
      return;
    }
    try {
      const payload = {
        startsAt: startAt,
        endsAt: endAt,
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

  return (
    <Dialog open={state.open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle>{state.eventId ? "Edit event" : "New event"}</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5 grid gap-6">
          {/* When */}
          <Section title="When" hint={dur ? `${dur}${startDate !== endDate ? " · spans days" : ""}` : undefined}>
            <div className="grid gap-3">
              <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <div className="grid gap-1.5">
                  <Label htmlFor="ev-start-date" className="text-xs text-muted-foreground">
                    Starts
                  </Label>
                  <Input id="ev-start-date" type="date" className="h-10" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <Input
                  aria-label="Start time"
                  type="time"
                  className="h-10 w-32"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <div className="grid gap-1.5">
                  <Label htmlFor="ev-end-date" className="text-xs text-muted-foreground">
                    Ends
                  </Label>
                  <Input id="ev-end-date" type="date" className="h-10" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
                <Input
                  aria-label="End time"
                  type="time"
                  className="h-10 w-32"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          </Section>

          {/* Tasks */}
          <Section
            title="Tasks"
            hint={taskIds.length > 1 ? "parallel — ratio unknown" : taskIds.length === 1 ? "1 attributed" : undefined}
          >
            {taskIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {taskIds.map((id) => (
                  <Badge key={id} variant="secondary" className="gap-1 py-1 pl-2.5">
                    {tasksById.get(id)?.name ?? id}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => toggleTask(id)}
                      aria-label="Remove task"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : null}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search tasks to attribute…"
                className="h-10 pl-8"
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value)}
              />
            </div>
            {taskFilter.trim() || taskIds.length === 0 ? (
              <div className="max-h-44 overflow-y-auto rounded-lg border divide-y">
                {filteredTasks.slice(0, 40).map((t) => {
                  const on = taskIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTask(t.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-accent/40",
                        on && "bg-accent/40",
                      )}
                    >
                      <span
                        className={cn(
                          "size-4 rounded border flex items-center justify-center shrink-0",
                          on ? "bg-primary border-primary text-primary-foreground" : "border-input",
                        )}
                      >
                        {on ? <Check className="size-3" /> : null}
                      </span>
                      <span className="truncate flex-1">{t.name}</span>
                      {t.project ? <span className="text-xs text-muted-foreground">{t.project.name}</span> : null}
                    </button>
                  );
                })}
                {filteredTasks.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted-foreground">No matching tasks.</p>
                ) : null}
              </div>
            ) : null}
          </Section>

          {/* Details */}
          <Section title="Details">
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <div className="inline-flex rounded-lg border p-0.5 w-fit">
                  {[
                    { v: EventKind.ACTIVE, label: "Active" },
                    { v: EventKind.BACKGROUND, label: "Background" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setKind(opt.v)}
                      className={cn(
                        "px-3 py-1.5 text-sm rounded-md transition-colors",
                        kind === opt.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {kind === EventKind.BACKGROUND ? (
                  <p className="text-xs text-muted-foreground">
                    Background events (sleep, work hours, commute) render as light bands behind your tasks.
                  </p>
                ) : null}
              </div>

              <label className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5 cursor-pointer">
                <span>
                  <span className="text-sm font-medium block">Lazy log</span>
                  <span className="text-xs text-muted-foreground">
                    Record that it happened without trusting the exact window — lowers confidence.
                  </span>
                </span>
                <Switch checked={lazy} onCheckedChange={(v) => setLazy(Boolean(v))} />
              </label>

              <div className="grid gap-1.5">
                <Label htmlFor="ev-notes" className="text-xs text-muted-foreground">
                  Notes
                </Label>
                <Textarea id="ev-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </Section>
        </div>

        <DialogFooter className="px-6 py-4 border-t justify-between">
          <div>
            {state.eventId ? (
              <Button variant="ghost" size="sm" onClick={onDelete}>
                <Trash2 className="size-4" /> Delete
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={pending}>
              {state.eventId ? "Save changes" : "Log event"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
