"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Plus, Search, Trash2, X } from "lucide-react";
import { EventKind, TimeBlockKind } from "@prisma/client";

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
import { REPEAT_OPTIONS, repeatToRrule, type Repeat } from "@/lib/recurrence";

type Mode = "event" | "block";
type WhenMode = "manual" | "auto";

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
function toIntOrNull(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
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

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export function EventFormDialog({ state, onClose }: { state: EventDialogState; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: tasks } = trpc.tasks.list.useQuery({});
  const { data: existing, isLoading: existingLoading } = trpc.events.get.useQuery(
    { id: state.eventId ?? "" },
    { enabled: Boolean(state.eventId) },
  );

  const editing = Boolean(state.eventId);
  const [mode, setMode] = useState<Mode>("event");
  const [whenMode, setWhenMode] = useState<WhenMode>("manual");

  const [eventTitle, setEventTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("10:00");
  const [lazy, setLazy] = useState(false);
  const [notes, setNotes] = useState("");
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [taskFilter, setTaskFilter] = useState("");

  // auto-mode metrics
  const [estimateMin, setEstimateMin] = useState("");
  const [stressVal, setStressVal] = useState("");
  const [exhVal, setExhVal] = useState("");

  // block-only
  const [blockKind, setBlockKind] = useState<TimeBlockKind>(TimeBlockKind.SLEEP);
  const [blockLabel, setBlockLabel] = useState("");
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [schedulable, setSchedulable] = useState(false);

  useEffect(() => {
    if (!state.open) return;
    if (state.eventId && existing) {
      setMode("event");
      setWhenMode("manual");
      setEventTitle(existing.title ?? "");
      setStartDate(dateToInputValue(existing.startsAt));
      setStartTime(toTimeInputValue(existing.startsAt));
      setEndDate(dateToInputValue(existing.endsAt));
      setEndTime(toTimeInputValue(existing.endsAt));
      setLazy(existing.confidence < 1);
      setNotes(existing.notes ?? "");
      setTaskIds(existing.attributions.map((a) => a.taskId));
      setTaskFilter("");
    } else if (state.init) {
      setMode(state.init.kind === EventKind.BACKGROUND ? "block" : "event");
      setWhenMode("manual");
      setEventTitle("");
      setStartDate(dateToInputValue(state.init.startsAt));
      setStartTime(toTimeInputValue(state.init.startsAt));
      setEndDate(dateToInputValue(state.init.endsAt));
      setEndTime(toTimeInputValue(state.init.endsAt));
      setLazy(state.init.lazy ?? false);
      setNotes("");
      setTaskIds(state.init.taskIds ?? []);
      setTaskFilter("");
      setEstimateMin("");
      setStressVal("");
      setExhVal("");
      setBlockKind(TimeBlockKind.SLEEP);
      setBlockLabel("");
      setRepeat("none");
      setSchedulable(false);
    }
  }, [state.open, state.eventId, existing, state.init]);

  const createEvent = trpc.events.create.useMutation();
  const updateEvent = trpc.events.update.useMutation();
  const delEvent = trpc.events.delete.useMutation();
  const createBlock = trpc.timeBlocks.create.useMutation();
  const quickCapture = trpc.tasks.quickCapture.useMutation();
  const quickAdd = trpc.events.quickAdd.useMutation();
  const pending =
    createEvent.isPending ||
    updateEvent.isPending ||
    createBlock.isPending ||
    quickCapture.isPending ||
    quickAdd.isPending;

  // When editing, wait for existing to load before allowing save (prevents the
  // race where empty taskIds would wipe the event's attributions).
  const saveDisabled = pending || (editing && existingLoading);

  const startAt = combine(startDate, startTime);
  const endAt = combine(endDate, endTime);
  const dur = durationLabel(startAt, endAt);

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    const q = taskFilter.trim().toLowerCase();
    return q ? tasks.filter((t) => t.name.toLowerCase().includes(q)) : tasks;
  }, [tasks, taskFilter]);
  const tasksById = useMemo(() => new Map(tasks?.map((t) => [t.id, t]) ?? []), [tasks]);
  const exactMatch = useMemo(
    () => (tasks ?? []).some((t) => t.name.trim().toLowerCase() === taskFilter.trim().toLowerCase()),
    [tasks, taskFilter],
  );

  function toggleTask(id: string) {
    setTaskIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function createAndAttach() {
    const name = taskFilter.trim();
    if (!name) return;
    try {
      const task = await quickCapture.mutateAsync({ name });
      setTaskIds((prev) => [...prev, task.id]);
      setTaskFilter("");
      await utils.tasks.list.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create task.");
    }
  }

  async function onSave() {
    try {
      // ── Background block ──
      if (mode === "block") {
        if (!startAt || !endAt) {
          toast.error("Pick a valid start and end.");
          return;
        }
        if (endAt <= startAt) {
          toast.error("End must be after start.");
          return;
        }
        await createBlock.mutateAsync({
          startsAt: startAt,
          endsAt: endAt,
          kind: blockKind,
          label: blockLabel.trim() || null,
          rrule: repeatToRrule(repeat),
          schedulableOnTop: schedulable,
        });
        toast.success(repeat === "none" ? "Background block added." : "Recurring block added.");
        await utils.timeBlocks.occurrences.invalidate();
        await utils.timeBlocks.list.invalidate();
        onClose();
        return;
      }

      // ── Event: find a spot (auto-schedule) ──
      if (whenMode === "auto" && !editing) {
        const title = eventTitle.trim();
        if (!title) {
          toast.error("Add a name first.");
          return;
        }
        await quickAdd.mutateAsync({
          title,
          description: notes.trim() || null,
          estimatedMinutes: toIntOrNull(estimateMin),
          stress: toIntOrNull(stressVal),
          exhaustion: toIntOrNull(exhVal),
          attachTaskId: taskIds[0] ?? null,
        });
        toast.success("Scheduled — drag it to adjust.");
        await Promise.all([utils.events.list.invalidate(), utils.tasks.list.invalidate()]);
        onClose();
        return;
      }

      // ── Event: manual time ──
      if (!startAt || !endAt) {
        toast.error("Pick a valid start and end.");
        return;
      }
      if (endAt <= startAt) {
        toast.error("End must be after start.");
        return;
      }
      const payload = {
        title: eventTitle.trim() || null,
        startsAt: startAt,
        endsAt: endAt,
        notes: notes.trim() || null,
        kind: EventKind.ACTIVE,
        lazy,
        attributions: taskIds.map((id) => ({ taskId: id, weight: 1, ratioUnknown: false })),
      };
      if (state.eventId) {
        await updateEvent.mutateAsync({ id: state.eventId, ...payload });
        toast.success("Event updated.");
      } else {
        await createEvent.mutateAsync(payload);
        toast.success("Event logged.");
      }
      await utils.events.list.invalidate();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    }
  }

  async function onDelete() {
    if (!state.eventId) return;
    if (!confirm("Delete this event?")) return;
    try {
      await delEvent.mutateAsync({ id: state.eventId });
      await utils.events.list.invalidate();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete.");
    }
  }

  const title = editing
    ? "Edit event"
    : mode === "block"
    ? "New background block"
    : whenMode === "auto"
    ? "Quick-add event"
    : "New event";

  return (
    <Dialog open={state.open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4 grid gap-4">
          {/* Type toggle (event vs block) — create only */}
          {!editing ? (
            <div className="inline-flex rounded-lg border p-0.5 w-full">
              {([
                { v: "event", label: "Event / task" },
                { v: "block", label: "Background block" },
              ] as const).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setMode(opt.v)}
                  className={cn(
                    "flex-1 px-3 py-1 text-sm rounded-md transition-colors",
                    mode === opt.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null}

          {mode === "event" ? (
            <>
              {/* Name (full width) */}
              <div className="grid gap-1">
                <Label htmlFor="ev-title" className="text-xs text-muted-foreground">Name</Label>
                <Input
                  id="ev-title"
                  className="h-9"
                  placeholder="What is this? e.g. Dentist, Draft proposal…"
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                {/* LEFT COLUMN: When + (auto) metrics + Lazy */}
                <div className="grid gap-4">
                  <section>
                    <SectionHeader
                      title="When"
                      hint={whenMode === "manual" && dur ? `${dur}${startDate !== endDate ? " · spans days" : ""}` : undefined}
                    />
                    {!editing ? (
                      <div className="inline-flex rounded-lg border p-0.5 w-full mb-2">
                        {([
                          { v: "manual", label: "Pick a time" },
                          { v: "auto", label: "Find a spot" },
                        ] as const).map((opt) => (
                          <button
                            key={opt.v}
                            type="button"
                            onClick={() => setWhenMode(opt.v)}
                            className={cn(
                              "flex-1 px-2 py-1 text-xs rounded-md transition-colors",
                              whenMode === opt.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {whenMode === "manual" || editing ? (
                      <div className="grid gap-2">
                        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                          <div className="grid gap-1">
                            <Label htmlFor="ev-start-date" className="text-xs text-muted-foreground">Starts</Label>
                            <Input id="ev-start-date" type="date" className="h-9" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                          </div>
                          <Input aria-label="Start time" type="time" className="h-9 w-28" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                          <div className="grid gap-1">
                            <Label htmlFor="ev-end-date" className="text-xs text-muted-foreground">Ends</Label>
                            <Input id="ev-end-date" type="date" className="h-9" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                          </div>
                          <Input aria-label="End time" type="time" className="h-9 w-28" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground leading-snug">
                        Placed in the next free slot in your working hours — drag to adjust.
                      </p>
                    )}
                  </section>

                  {whenMode === "auto" && !editing ? (
                    <section>
                      <SectionHeader title="How long & how hard" hint="optional" />
                      <div className="grid grid-cols-3 gap-2">
                        <div className="grid gap-1">
                          <Label htmlFor="ev-est" className="text-xs text-muted-foreground">Minutes</Label>
                          <Input id="ev-est" type="number" inputMode="numeric" min={5} className="h-9" placeholder="60" value={estimateMin} onChange={(e) => setEstimateMin(e.target.value)} />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor="ev-stress" className="text-xs text-muted-foreground">Stress</Label>
                          <Input id="ev-stress" type="number" inputMode="numeric" min={0} max={10} className="h-9" value={stressVal} onChange={(e) => setStressVal(e.target.value)} />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor="ev-exh" className="text-xs text-muted-foreground">Exhaust</Label>
                          <Input id="ev-exh" type="number" inputMode="numeric" min={0} max={10} className="h-9" value={exhVal} onChange={(e) => setExhVal(e.target.value)} />
                        </div>
                      </div>
                    </section>
                  ) : null}

                  {whenMode === "manual" || editing ? (
                    <label className="flex items-center justify-between gap-3 text-sm cursor-pointer">
                      <span className="flex items-baseline gap-2">
                        <span className="font-medium">Lazy log</span>
                        <span className="text-xs text-muted-foreground">lowers confidence</span>
                      </span>
                      <Switch checked={lazy} onCheckedChange={(v) => setLazy(Boolean(v))} />
                    </label>
                  ) : null}
                </div>

                {/* RIGHT COLUMN: Tasks (chips + search + on-demand list) + About */}
                <div className="grid gap-4 min-w-0">
                  <section>
                    <SectionHeader
                      title="Tasks"
                      hint={taskIds.length > 1 ? "parallel" : taskIds.length === 1 ? "1 attached" : "optional"}
                    />
                    {taskIds.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {taskIds.map((id) => (
                          <Badge key={id} variant="secondary" className="gap-1 py-0.5 pl-2 max-w-full">
                            <span className="truncate">{tasksById.get(id)?.name ?? id}</span>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground shrink-0"
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
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                      <Input
                        placeholder="Search or type a new task…"
                        className="h-9 pl-8"
                        value={taskFilter}
                        onChange={(e) => setTaskFilter(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && taskFilter.trim() && !exactMatch) {
                            e.preventDefault();
                            void createAndAttach();
                          }
                        }}
                      />
                    </div>
                    {/* Inline create / list only when the user is actively searching. */}
                    {taskFilter.trim() ? (
                      <div className="mt-2 rounded-lg border divide-y max-h-40 overflow-y-auto">
                        {!exactMatch ? (
                          <button
                            type="button"
                            onClick={createAndAttach}
                            className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-accent/40"
                          >
                            <Plus className="size-3.5 text-primary" />
                            <span className="truncate">Create &ldquo;{taskFilter.trim()}&rdquo;</span>
                          </button>
                        ) : null}
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
                              <span className={cn("size-4 rounded border flex items-center justify-center shrink-0", on ? "bg-primary border-primary text-primary-foreground" : "border-input")}>
                                {on ? <Check className="size-3" /> : null}
                              </span>
                              <span className="truncate flex-1">{t.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>

                  <section>
                    <SectionHeader title="About" hint="optional" />
                    <Textarea
                      rows={2}
                      placeholder="What is this about?"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </section>
                </div>
              </div>
            </>
          ) : (
            /* Background block — single column inside the wider dialog */
            <section className="grid gap-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="blk-kind" className="text-xs text-muted-foreground">Kind</Label>
                  <select
                    id="blk-kind"
                    value={blockKind}
                    onChange={(e) => setBlockKind(e.target.value as TimeBlockKind)}
                    className="h-10 rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    {Object.values(TimeBlockKind).map((k) => (
                      <option key={k} value={k}>{k.toLowerCase().replace("_", " ")}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="blk-repeat" className="text-xs text-muted-foreground">Repeats</Label>
                  <select
                    id="blk-repeat"
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value as Repeat)}
                    className="h-10 rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    {REPEAT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                  <div className="grid gap-1.5">
                    <Label htmlFor="blk-start-date" className="text-xs text-muted-foreground">Starts</Label>
                    <Input id="blk-start-date" type="date" className="h-10" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <Input aria-label="Start time" type="time" className="h-10 w-28" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                  <div className="grid gap-1.5">
                    <Label htmlFor="blk-end-date" className="text-xs text-muted-foreground">Ends</Label>
                    <Input id="blk-end-date" type="date" className="h-10" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                  <Input aria-label="End time" type="time" className="h-10 w-28" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="blk-label" className="text-xs text-muted-foreground">Label</Label>
                <Input id="blk-label" placeholder="e.g. Sleep, Work hours, Commute" className="h-10" value={blockLabel} onChange={(e) => setBlockLabel(e.target.value)} />
              </div>
              <label className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5 cursor-pointer">
                <span>
                  <span className="text-sm font-medium block">Schedulable on top</span>
                  <span className="text-xs text-muted-foreground">
                    Let the planner still place tasks during this block.
                  </span>
                </span>
                <Switch checked={schedulable} onCheckedChange={(v) => setSchedulable(Boolean(v))} />
              </label>
            </section>
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t justify-between">
          <div>
            {state.eventId ? (
              <Button variant="ghost" size="sm" onClick={onDelete}>
                <Trash2 className="size-4" /> Delete
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={onSave} disabled={saveDisabled}>
              {editing
                ? "Save changes"
                : mode === "block"
                ? "Add block"
                : whenMode === "auto"
                ? "Find a spot & add"
                : "Log event"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
