"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
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
import { TagPicker } from "@/components/tasks/tag-picker";
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
    /** True when the user picked this time deliberately (e.g. drag-to-create
     * on the calendar grid). Without this, the dialog defaults to
     * "Find a spot" — which silently throws their pick away. */
    pickedTime?: boolean;
  };
};

type AiOverlayState =
  | { phase: "inferring" }
  | { phase: "done"; inferred: Partial<Record<"estimatedMinutes" | "stress" | "exhaustion" | "importance" | "urgency", number>> };

const CONFETTI = ["✦", "✶", "✷", "✺", "✹", "✧"];
const FIELD_LABELS: Record<string, string> = {
  estimatedMinutes: "Min",
  stress: "Stress",
  exhaustion: "Exhaust",
  importance: "Importance",
  urgency: "Urgency",
};
const DONE_FLAVOUR = [
  "AI sweated the small stuff for you.",
  "Sized up and slotted in.",
  "Filed under: done.",
  "On the books — drag it around if you don't agree.",
];

function AiOverlay({ state }: { state: AiOverlayState }) {
  // Stable confetti positions per mount so they don't jitter on re-render.
  const confetti = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        char: CONFETTI[i % CONFETTI.length],
        left: 8 + ((i * 37) % 84),
        top: 6 + ((i * 53) % 80),
        delay: (i * 90) % 700,
        size: 14 + ((i * 7) % 14),
      })),
    [],
  );
  const flavour = useMemo(() => DONE_FLAVOUR[Math.floor(Math.random() * DONE_FLAVOUR.length)], []);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-popover/95 backdrop-blur-sm animate-in fade-in-0 duration-200">
      {state.phase === "inferring" ? (
        <div className="flex flex-col items-center gap-3 text-center px-6">
          <Sparkles className="size-10 text-primary animate-pulse" />
          <p className="font-heading text-2xl tracking-tight">Sizing up your task…</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Claude is reading your description and filling in the blanks.
          </p>
        </div>
      ) : (
        <div className="relative flex flex-col items-center gap-3 text-center px-6 py-4 animate-in zoom-in-95 fade-in-0 duration-300">
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {confetti.map((c, i) => (
              <span
                key={i}
                className="absolute text-primary/70 animate-bounce"
                style={{
                  left: `${c.left}%`,
                  top: `${c.top}%`,
                  fontSize: `${c.size}px`,
                  animationDelay: `${c.delay}ms`,
                  animationDuration: "1.4s",
                }}
              >
                {c.char}
              </span>
            ))}
          </div>
          <Sparkles className="size-10 text-primary" />
          <p className="font-heading text-2xl tracking-tight">All set</p>
          <p className="text-xs text-muted-foreground max-w-xs">{flavour}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {Object.entries(state.inferred).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 min-w-32">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{FIELD_LABELS[k] ?? k}</span>
                <span className="font-mono tabular-nums">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

// Inputs in the sidebar use a stripped-down, bottom-border-only style so the
// sidebar reads as metadata rather than a stack of form fields.
const discreteInputClass =
  "h-7 border-0 border-b border-input rounded-none px-1 text-xs shadow-none focus-visible:ring-0 focus-visible:border-foreground/60 dark:bg-transparent";

function MetaRow({
  label,
  value,
  onChange,
  placeholder,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="grid grid-cols-[1fr_5rem] items-center gap-2 text-xs">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</span>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        className={discreteInputClass}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
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
  const [whenMode, setWhenMode] = useState<WhenMode>("auto");

  const [eventTitle, setEventTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("10:00");
  const [lazy, setLazy] = useState(false);
  const [notes, setNotes] = useState("");
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [taskFilter, setTaskFilter] = useState("");
  const [createTask, setCreateTask] = useState(true);
  // Tags get applied to the linked task (event color is derived from them).
  const [tagIds, setTagIds] = useState<string[]>([]);

  // Task metadata — left blank, Claude infers from description.
  const [estimateMin, setEstimateMin] = useState("");
  const [stressVal, setStressVal] = useState("");
  const [exhVal, setExhVal] = useState("");
  const [impVal, setImpVal] = useState("");
  const [urgVal, setUrgVal] = useState("");
  const [dueDate, setDueDate] = useState("");

  // block-only
  const [blockKind, setBlockKind] = useState<TimeBlockKind>(TimeBlockKind.SLEEP);
  const [blockLabel, setBlockLabel] = useState("");
  const [schedulable, setSchedulable] = useState(false);

  // shared by both branches — "Repeats" applies to events (writes a
  // RecurrenceRule on the linked task) and to background blocks (rrule on
  // the block itself).
  const [repeat, setRepeat] = useState<Repeat>("none");

  // AI overlay states.
  type AiState =
    | { phase: "idle" }
    | { phase: "inferring" }
    | { phase: "done"; inferred: Partial<Record<"estimatedMinutes" | "stress" | "exhaustion" | "importance" | "urgency", number>> };
  const [aiState, setAiState] = useState<AiState>({ phase: "idle" });

  useEffect(() => {
    if (!state.open) return;
    if (state.eventId && existing) {
      setMode("event");
      setWhenMode("manual");
      // Fall back to the linked task's name — events created via drop-on-calendar
      // / log-task don't set their own title, so existing.title is null.
      setEventTitle(existing.title ?? existing.attributions[0]?.task?.name ?? "");
      setStartDate(dateToInputValue(existing.startsAt));
      setStartTime(toTimeInputValue(existing.startsAt));
      setEndDate(dateToInputValue(existing.endsAt));
      setEndTime(toTimeInputValue(existing.endsAt));
      setLazy(existing.confidence < 1);
      // Same trick as title: quickAdd stores description on the linked Task,
      // not on the Event. Fall back so editing shows what was originally typed.
      setNotes(existing.notes ?? existing.attributions[0]?.task?.description ?? "");
      setTaskIds(existing.attributions.map((a) => a.taskId));
      setTaskFilter("");
      setCreateTask(false);
      // Seed metadata + tags from the title task — that's where the event color
      // and the user's planning numbers actually live.
      const titleTask = existing.attributions[0]?.task;
      setEstimateMin(titleTask?.estimatedMinutes != null ? String(titleTask.estimatedMinutes) : "");
      setStressVal(titleTask?.stress != null ? String(titleTask.stress) : "");
      setExhVal(titleTask?.exhaustion != null ? String(titleTask.exhaustion) : "");
      setImpVal(titleTask?.importance != null ? String(titleTask.importance) : "");
      setUrgVal(titleTask?.urgency != null ? String(titleTask.urgency) : "");
      setDueDate(titleTask?.dueDate ? dateToInputValue(titleTask.dueDate) : "");
      setTagIds((titleTask?.tags ?? []).map((t) => t.tagId));
    } else if (state.init) {
      setMode(state.init.kind === EventKind.BACKGROUND ? "block" : "event");
      // If the user picked the time deliberately (drag-to-create on the
      // calendar), start in "Pick a time" mode so their pick survives.
      // For generic "New event" button clicks, default to "Find a spot".
      setWhenMode(state.init.pickedTime ? "manual" : "auto");
      setEventTitle("");
      setStartDate(dateToInputValue(state.init.startsAt));
      setStartTime(toTimeInputValue(state.init.startsAt));
      setEndDate(dateToInputValue(state.init.endsAt));
      setEndTime(toTimeInputValue(state.init.endsAt));
      setLazy(state.init.lazy ?? false);
      setNotes("");
      setTaskIds(state.init.taskIds ?? []);
      setTaskFilter("");
      setCreateTask(true);
      setEstimateMin("");
      setStressVal("");
      setExhVal("");
      setImpVal("");
      setUrgVal("");
      setDueDate("");
      setBlockKind(TimeBlockKind.SLEEP);
      setBlockLabel("");
      setRepeat("none");
      setSchedulable(false);
      setTagIds([]);
    }
    setAiState({ phase: "idle" });
  }, [state.open, state.eventId, existing, state.init]);

  const createEvent = trpc.events.create.useMutation();
  const updateEvent = trpc.events.update.useMutation();
  const delEvent = trpc.events.delete.useMutation();
  const createBlock = trpc.timeBlocks.create.useMutation();
  const quickCapture = trpc.tasks.quickCapture.useMutation();
  const quickAdd = trpc.events.quickAdd.useMutation();
  const updateTask = trpc.tasks.update.useMutation();
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

      // ── Editing an existing event: events.update, then write tags through to
      //    the title task so the event color picks them up.
      if (editing && state.eventId) {
        if (!startAt || !endAt) {
          toast.error("Pick a valid start and end.");
          return;
        }
        if (endAt <= startAt) {
          toast.error("End must be after start.");
          return;
        }
        await updateEvent.mutateAsync({
          id: state.eventId,
          title: eventTitle.trim() || null,
          startsAt: startAt,
          endsAt: endAt,
          notes: notes.trim() || null,
          kind: EventKind.ACTIVE,
          lazy,
          attributions: taskIds.map((id) => ({ taskId: id, weight: 1, ratioUnknown: false })),
        });
        // Persist tags to the first attached task (the one that drives color).
        const titleTaskId = taskIds[0] ?? existing?.attributions[0]?.taskId;
        const existingTagIds = (existing?.attributions[0]?.task?.tags ?? []).map((t) => t.tagId);
        const changed =
          tagIds.length !== existingTagIds.length ||
          tagIds.some((id) => !existingTagIds.includes(id));
        if (titleTaskId && changed) {
          await updateTask.mutateAsync({ id: titleTaskId, tagIds });
          await utils.tasks.list.invalidate();
        }
        toast.success("Event updated.");
        await utils.events.list.invalidate();
        onClose();
        return;
      }

      // ── New event (either When mode): always route through quickAdd so AI
      //    inference runs uniformly. Manual mode passes startsAt/endsAt;
      //    auto mode omits them and lets the server find a slot.
      const titleTrim = eventTitle.trim();
      if (!titleTrim) {
        toast.error("Add a name first.");
        return;
      }
      if (whenMode === "manual") {
        if (!startAt || !endAt) {
          toast.error("Pick a valid start and end.");
          return;
        }
        if (endAt <= startAt) {
          toast.error("End must be after start.");
          return;
        }
      }

      const provided = {
        estimatedMinutes: toIntOrNull(estimateMin),
        stress: toIntOrNull(stressVal),
        exhaustion: toIntOrNull(exhVal),
        importance: toIntOrNull(impVal),
        urgency: toIntOrNull(urgVal),
      };
      const willInfer =
        notes.trim().length > 0 &&
        Object.values(provided).some((v) => v == null);
      if (willInfer) setAiState({ phase: "inferring" });

      const result = await quickAdd.mutateAsync({
        title: titleTrim,
        description: notes.trim() || null,
        ...provided,
        dueDate: inputValueToDate(dueDate),
        attachTaskId: taskIds[0] ?? null,
        createTask: createTask && taskIds.length === 0,
        tagIds: tagIds.length ? tagIds : undefined,
        startsAt: whenMode === "manual" ? (startAt ?? null) : null,
        endsAt: whenMode === "manual" ? (endAt ?? null) : null,
        lazy,
        repeat,
      });

      await Promise.all([utils.events.list.invalidate(), utils.tasks.list.invalidate()]);

      const inferredEntries = Object.entries(result.inferred ?? {}).filter(
        ([, v]) => typeof v === "number",
      ) as [keyof typeof provided, number][];

      if (inferredEntries.length > 0) {
        setAiState({ phase: "done", inferred: Object.fromEntries(inferredEntries) });
        setTimeout(onClose, 1800);
      } else {
        toast.success(
          createTask && taskIds.length === 0
            ? "Scheduled with a new task — drag to adjust."
            : "Scheduled — drag it to adjust.",
        );
        onClose();
      }
    } catch (err) {
      setAiState({ phase: "idle" });
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
      <DialogContent className="sm:max-w-3xl gap-0 p-0 relative overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-2.5 border-b">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="px-5 py-3 grid gap-3">
          {mode === "event" ? (
            <div className="grid md:grid-cols-[1.35fr_1fr] gap-5 items-stretch">
              {/* MAIN COLUMN: title + big description (fills sidebar height) */}
              <div className="flex flex-col gap-2 min-w-0">
                <div className="grid gap-1 shrink-0">
                  <Label htmlFor="ev-title" className="text-xs text-muted-foreground">Name</Label>
                  <Input
                    id="ev-title"
                    className="h-10"
                    placeholder="What is this? e.g. Dentist, Draft proposal…"
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1 min-h-0">
                  <div className="flex items-baseline justify-between shrink-0">
                    <Label htmlFor="ev-notes" className="text-xs text-muted-foreground">Description</Label>
                    <span className="text-xs text-muted-foreground italic">AI fills the rest</span>
                  </div>
                  <Textarea
                    id="ev-notes"
                    placeholder="Anything else — links, context, sub-steps. Blank fields will be inferred."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="resize-none flex-1 min-h-0"
                  />
                </div>
              </div>

              {/* SIDEBAR: Jira-style metadata rows */}
              <div className="grid gap-2.5 min-w-0 content-start">
                {/* Type toggle */}
                {!editing ? (
                  <div className="inline-flex rounded-lg border p-0.5 w-full">
                    {([
                      { v: "event", label: "Event / task" },
                      { v: "block", label: "Block" },
                    ] as const).map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setMode(opt.v)}
                        className={cn(
                          "flex-1 px-2 py-0.5 text-xs rounded-md transition-colors",
                          mode === opt.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* When */}
                {!editing ? (
                  <div className="inline-flex rounded-lg border p-0.5 w-full">
                    {([
                      { v: "auto", label: "Find a spot" },
                      { v: "manual", label: "Pick a time" },
                    ] as const).map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setWhenMode(opt.v)}
                        className={cn(
                          "flex-1 px-2 py-0.5 text-xs rounded-md transition-colors",
                          whenMode === opt.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {whenMode === "manual" || editing ? (
                  <div className="grid gap-1.5">
                    <div className="grid grid-cols-[1fr_auto] gap-1.5 items-end">
                      <div className="grid gap-0.5">
                        <Label htmlFor="ev-start-date" className="text-[10px] text-muted-foreground uppercase tracking-wider">Starts</Label>
                        <Input id="ev-start-date" type="date" className={discreteInputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                      </div>
                      <Input aria-label="Start time" type="time" className={cn(discreteInputClass, "w-24")} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-1.5 items-end">
                      <div className="grid gap-0.5">
                        <Label htmlFor="ev-end-date" className="text-[10px] text-muted-foreground uppercase tracking-wider">Ends</Label>
                        <Input id="ev-end-date" type="date" className={discreteInputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                      </div>
                      <Input aria-label="End time" type="time" className={cn(discreteInputClass, "w-24")} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                    </div>
                    {dur ? <p className="text-[10px] text-muted-foreground -mt-1">{dur}{startDate !== endDate ? " · spans days" : ""}</p> : null}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Drops into the next free slot in your working hours — drag to adjust after.
                  </p>
                )}

                {!editing ? (
                  <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs">
                    <Label htmlFor="ev-repeat" className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Repeats</Label>
                    <select
                      id="ev-repeat"
                      value={repeat}
                      onChange={(e) => setRepeat(e.target.value as Repeat)}
                      className={cn(discreteInputClass, "w-32 bg-transparent")}
                    >
                      {REPEAT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {/* Jira-style metadata rows. Blank = AI infers. */}
                <div className="grid gap-1 pt-2 border-t">
                  <p className="text-[10px] text-muted-foreground italic mb-0.5">Blank fields get inferred from the description</p>
                  <MetaRow label="Minutes" value={estimateMin} onChange={setEstimateMin} placeholder="60" min={5} max={12 * 60} />
                  <MetaRow label="Stress" value={stressVal} onChange={setStressVal} placeholder="0–10" min={0} max={10} />
                  <MetaRow label="Exhaust" value={exhVal} onChange={setExhVal} placeholder="0–10" min={0} max={10} />
                  <MetaRow label="Importance" value={impVal} onChange={setImpVal} placeholder="0–10" min={0} max={10} />
                  <MetaRow label="Urgency" value={urgVal} onChange={setUrgVal} placeholder="0–10" min={0} max={10} />
                  <div className="grid grid-cols-[1fr_5rem] items-center gap-2 text-xs">
                    <Label htmlFor="ev-due" className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Due</Label>
                    <Input id="ev-due" type="date" className={discreteInputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </div>
                </div>

                {/* Task linkage */}
                <div className="grid gap-1.5 pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Task</h3>
                    {!editing ? (
                      <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                        <span className="text-muted-foreground">Auto-create</span>
                        <Switch
                          checked={createTask && taskIds.length === 0}
                          disabled={taskIds.length > 0}
                          onCheckedChange={(v) => setCreateTask(Boolean(v))}
                        />
                      </label>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {taskIds.length > 1 ? "parallel" : taskIds.length === 1 ? "1 attached" : "optional"}
                      </span>
                    )}
                  </div>
                  {taskIds.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {taskIds.map((id) => (
                        <Badge key={id} variant="secondary" className="gap-1 py-0.5 pl-2 max-w-full text-xs">
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
                    <Search className="absolute left-1 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Attach existing task…"
                      className={cn(discreteInputClass, "pl-6")}
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
                  {taskFilter.trim() ? (
                    <div className="rounded-lg border divide-y max-h-40 overflow-y-auto">
                      {!exactMatch ? (
                        <button
                          type="button"
                          onClick={createAndAttach}
                          className="w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 hover:bg-accent/40"
                        >
                          <Plus className="size-3 text-primary" />
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
                              "w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 hover:bg-accent/40",
                              on && "bg-accent/40",
                            )}
                          >
                            <span className={cn("size-3.5 rounded border flex items-center justify-center shrink-0", on ? "bg-primary border-primary text-primary-foreground" : "border-input")}>
                              {on ? <Check className="size-2.5" /> : null}
                            </span>
                            <span className="truncate flex-1">{t.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                {/* Tags — drive the event's color (first tag with a color wins). */}
                <div className="grid gap-1.5 pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Tags</h3>
                    <span className="text-[11px] text-muted-foreground">color the block</span>
                  </div>
                  <TagPicker value={tagIds} onChange={setTagIds} placeholder="Tag this event…" />
                </div>

                {whenMode === "manual" || editing ? (
                  <label className="flex items-center justify-between gap-3 text-[11px] cursor-pointer pt-1.5 border-t">
                    <span className="flex items-baseline gap-2">
                      <span className="font-medium">Lazy log</span>
                      <span className="text-muted-foreground">lowers confidence</span>
                    </span>
                    <Switch checked={lazy} onCheckedChange={(v) => setLazy(Boolean(v))} />
                  </label>
                ) : null}
              </div>
            </div>
          ) : (
            /* Background block — single column inside the wider dialog */
            <section className="grid gap-4">
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

        {aiState.phase !== "idle" ? <AiOverlay state={aiState} /> : null}

        <DialogFooter className="m-0 px-5 py-2.5 border-t rounded-b-xl justify-between">
          <div>
            {state.eventId ? (
              <Button variant="ghost" size="sm" onClick={onDelete}>
                <Trash2 className="size-4" /> Delete
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={onSave} disabled={saveDisabled}>
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
