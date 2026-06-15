"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { EventKind } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TagPicker } from "@/components/tasks/tag-picker";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { dateToInputValue, inputValueToDate } from "@/lib/format";
import { REPEAT_OPTIONS, type Repeat } from "@/lib/recurrence";

export type WizardInit = {
  startsAt?: Date;
  endsAt?: Date;
  pickedTime?: boolean;
  kind?: EventKind;
};

type Step = "capture" | "clarify" | "confirm";

type MetricKey = "estimatedMinutes" | "stress" | "exhaustion" | "importance" | "urgency";
type FieldKey = "title" | MetricKey | "repeat" | "whenHint";

type Confidence = "green" | "yellow" | "red" | "pending";

const FIELD_LABEL: Record<FieldKey, string> = {
  title: "Title",
  estimatedMinutes: "Duration",
  stress: "Stress",
  exhaustion: "Exhaust",
  importance: "Importance",
  urgency: "Urgency",
  repeat: "Repeats",
  whenHint: "When",
};

const CLARIFY_PROMPTS: Partial<Record<FieldKey, string>> = {
  estimatedMinutes: "How long do you think this will take?",
  stress: "How stressful does this feel? (0 trivial, 10 high-stakes)",
  exhaustion: "How draining will this be? (0 restorative, 10 wiped)",
  importance: "How important is this in the long run? (0 trivial, 10 life-defining)",
  urgency: "How time-sensitive is this? (0 no rush, 10 must do now)",
  repeat: "Does this repeat? Pick a cadence below.",
  whenHint: "Roughly when do you want this — ASAP, this week, or no rush?",
};

function confidenceBand(c: number | null): Confidence {
  if (c == null) return "pending";
  if (c >= 0.8) return "green";
  if (c >= 0.5) return "yellow";
  return "red";
}

function bandColor(b: Confidence): string {
  switch (b) {
    case "green": return "bg-emerald-500";
    case "yellow": return "bg-amber-500";
    case "red": return "bg-rose-500";
    case "pending": return "bg-muted-foreground/30 animate-pulse";
  }
}

type Draft = {
  title: { value: string; confidence: number | null };
  estimatedMinutes: { value: number | null; confidence: number | null };
  stress: { value: number | null; confidence: number | null };
  exhaustion: { value: number | null; confidence: number | null };
  importance: { value: number | null; confidence: number | null };
  urgency: { value: number | null; confidence: number | null };
  repeat: { value: Repeat; confidence: number | null };
  whenHint: { value: string; confidence: number | null };
};

function emptyDraft(): Draft {
  return {
    title: { value: "", confidence: null },
    estimatedMinutes: { value: null, confidence: null },
    stress: { value: null, confidence: null },
    exhaustion: { value: null, confidence: null },
    importance: { value: null, confidence: null },
    urgency: { value: null, confidence: null },
    repeat: { value: "none", confidence: null },
    whenHint: { value: "no_rush", confidence: null },
  };
}

export function EventCreateWizard({
  open,
  init,
  onClose,
}: {
  open: boolean;
  init: WizardInit | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const quickAdd = trpc.events.quickAdd.useMutation();
  const createBlock = trpc.timeBlocks.create.useMutation();

  const [step, setStep] = useState<Step>("capture");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [streaming, setStreaming] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);

  // Step 3 user-editable mirrors. Init from draft when entering step 3.
  const [title, setTitle] = useState("");
  const [whenMode, setWhenMode] = useState<"auto" | "manual">("auto");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("10:00");

  const streamAbort = useRef<AbortController | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset everything when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStep("capture");
    setDescription("");
    setDraft(emptyDraft());
    setStreaming(false);
    setTagIds([]);
    setTitle("");
    if (init?.pickedTime && init.startsAt && init.endsAt) {
      setWhenMode("manual");
      setStartDate(dateToInputValue(init.startsAt));
      setStartTime(toTime(init.startsAt));
      setEndDate(dateToInputValue(init.endsAt));
      setEndTime(toTime(init.endsAt));
    } else {
      setWhenMode("auto");
      const now = new Date();
      setStartDate(dateToInputValue(now));
      setStartTime("09:00");
      setEndDate(dateToInputValue(now));
      setEndTime("10:00");
    }
  }, [open, init]);

  // Debounced streaming inference as the description grows.
  useEffect(() => {
    if (!open || step !== "capture") return;
    if (description.trim().length < 5) {
      setDraft(emptyDraft());
      return;
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void runInference();
    }, 400);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, open, step]);

  async function runInference() {
    streamAbort.current?.abort();
    const ctrl = new AbortController();
    streamAbort.current = ctrl;
    setStreaming(true);
    // Reset every confidence to pending while the new pass runs.
    setDraft((d) => ({
      title: { value: d.title.value, confidence: null },
      estimatedMinutes: { value: d.estimatedMinutes.value, confidence: null },
      stress: { value: d.stress.value, confidence: null },
      exhaustion: { value: d.exhaustion.value, confidence: null },
      importance: { value: d.importance.value, confidence: null },
      urgency: { value: d.urgency.value, confidence: null },
      repeat: { value: d.repeat.value, confidence: null },
      whenHint: { value: d.whenHint.value, confidence: null },
    }));

    try {
      const resp = await fetch("/api/events/draft", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          pickedTime: init?.pickedTime && init.startsAt && init.endsAt
            ? { startsAt: init.startsAt.toISOString(), endsAt: init.endsAt.toISOString() }
            : null,
        }),
      });
      if (!resp.ok || !resp.body) throw new Error(`Inference failed (${resp.status})`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 2);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const evt = JSON.parse(payload) as { field?: FieldKey; value?: unknown; confidence?: number; error?: string };
            if (evt.error) {
              toast.error(`AI inference: ${evt.error}`);
              continue;
            }
            if (evt.field && typeof evt.confidence === "number") {
              applyDelta(evt.field, evt.value, evt.confidence);
            }
          } catch {
            // ignore malformed
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error(err instanceof Error ? err.message : "Inference failed.");
      }
    } finally {
      if (streamAbort.current === ctrl) {
        setStreaming(false);
        streamAbort.current = null;
      }
    }
  }

  function applyDelta(field: FieldKey, value: unknown, confidence: number) {
    setDraft((d) => {
      const next = { ...d };
      switch (field) {
        case "title":
          next.title = { value: typeof value === "string" ? value : d.title.value, confidence };
          break;
        case "estimatedMinutes":
        case "stress":
        case "exhaustion":
        case "importance":
        case "urgency":
          next[field] = {
            value: typeof value === "number" ? value : d[field].value,
            confidence,
          };
          break;
        case "repeat":
          next.repeat = {
            value: typeof value === "string" && ["none", "daily", "weekdays", "weekly"].includes(value)
              ? (value as Repeat)
              : d.repeat.value,
            confidence,
          };
          break;
        case "whenHint":
          next.whenHint = {
            value: typeof value === "string" ? value : d.whenHint.value,
            confidence,
          };
          break;
      }
      return next;
    });
  }

  // Fields needing clarification = anything yellow/red after streaming ends.
  const yellowRed = useMemo<FieldKey[]>(() => {
    if (streaming) return [];
    const fields: FieldKey[] = [];
    (Object.keys(CLARIFY_PROMPTS) as FieldKey[]).forEach((f) => {
      const c = (draft as Record<FieldKey, { value: unknown; confidence: number | null }>)[f].confidence;
      if (c != null && c < 0.8) fields.push(f);
    });
    return fields;
  }, [draft, streaming]);

  function goToConfirm() {
    setTitle(draft.title.value || description.trim().split("\n")[0].slice(0, 80));
    setStep("confirm");
  }

  async function onSave() {
    const titleTrim = title.trim();
    if (!titleTrim) {
      toast.error("Add a name first.");
      return;
    }

    const startAt = combine(startDate, startTime);
    const endAt = combine(endDate, endTime);
    if (whenMode === "manual") {
      if (!startAt || !endAt || endAt <= startAt) {
        toast.error("Pick a valid start and end.");
        return;
      }
    }

    try {
      await quickAdd.mutateAsync({
        title: titleTrim,
        description: description.trim() || null,
        estimatedMinutes: draft.estimatedMinutes.value ?? null,
        stress: draft.stress.value ?? null,
        exhaustion: draft.exhaustion.value ?? null,
        importance: draft.importance.value ?? null,
        urgency: draft.urgency.value ?? null,
        dueDate: null,
        attachTaskId: null,
        createTask: true,
        tagIds: tagIds.length ? tagIds : undefined,
        startsAt: whenMode === "manual" ? startAt : null,
        endsAt: whenMode === "manual" ? endAt : null,
        lazy: false,
        repeat: draft.repeat.value,
      });
      await Promise.all([utils.events.list.invalidate(), utils.tasks.list.invalidate()]);
      toast.success("Scheduled.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-2xl gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-3 border-b">
          <DialogTitle>New event</DialogTitle>
          <ProgressBar step={step} onJump={(s) => setStep(s)} canClarify={yellowRed.length > 0} />
        </DialogHeader>

        <div className="px-5 py-4 min-h-[360px]">
          {step === "capture" && (
            <CaptureStep
              description={description}
              setDescription={setDescription}
              draft={draft}
              streaming={streaming}
            />
          )}
          {step === "clarify" && (
            <ClarifyStep
              fields={yellowRed}
              draft={draft}
              onUpdate={(field, value) => {
                applyDelta(field, value, 1);
              }}
            />
          )}
          {step === "confirm" && (
            <ConfirmStep
              title={title}
              setTitle={setTitle}
              draft={draft}
              setDraft={setDraft}
              whenMode={whenMode}
              setWhenMode={setWhenMode}
              startDate={startDate} setStartDate={setStartDate}
              startTime={startTime} setStartTime={setStartTime}
              endDate={endDate} setEndDate={setEndDate}
              endTime={endTime} setEndTime={setEndTime}
              tagIds={tagIds}
              setTagIds={setTagIds}
              forceManual={init?.pickedTime ?? false}
            />
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t bg-card">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <div className="flex gap-2">
            {step !== "capture" && (
              <Button variant="outline" size="sm" onClick={() => setStep(step === "confirm" && yellowRed.length > 0 ? "clarify" : "capture")}>
                <ChevronLeft className="size-4" /> Back
              </Button>
            )}
            {step === "capture" && (
              <Button
                size="sm"
                onClick={() => (yellowRed.length > 0 ? setStep("clarify") : goToConfirm())}
                disabled={description.trim().length < 5 || streaming}
              >
                Continue <ChevronRight className="size-4" />
              </Button>
            )}
            {step === "clarify" && (
              <Button size="sm" onClick={goToConfirm}>
                Continue <ChevronRight className="size-4" />
              </Button>
            )}
            {step === "confirm" && (
              <Button size="sm" onClick={onSave} disabled={quickAdd.isPending || createBlock.isPending}>
                <Check className="size-4" /> Save
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProgressBar({ step, onJump, canClarify }: { step: Step; onJump: (s: Step) => void; canClarify: boolean }) {
  const steps: { id: Step; label: string }[] = [
    { id: "capture", label: "Describe" },
    { id: "clarify", label: "Clarify" },
    { id: "confirm", label: "Confirm" },
  ];
  const stepIndex = steps.findIndex((s) => s.id === step);
  return (
    <div className="flex items-center gap-2 mt-3">
      {steps.map((s, i) => {
        const active = s.id === step;
        const done = i < stepIndex;
        const skippable = s.id === "clarify" && !canClarify;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              if (skippable) return;
              if (i <= stepIndex) onJump(s.id);
            }}
            disabled={skippable || i > stepIndex}
            className={cn(
              "flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-medium px-2 py-1 rounded transition-colors",
              active ? "text-foreground" : done ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/50",
              skippable && "opacity-50 cursor-not-allowed",
            )}
          >
            <span className={cn("size-4 rounded-full flex items-center justify-center text-[10px] font-mono", active ? "bg-primary text-primary-foreground" : done ? "bg-emerald-500 text-white" : "bg-muted")}>
              {done ? <Check className="size-2.5" /> : i + 1}
            </span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function CaptureStep({
  description,
  setDescription,
  draft,
  streaming,
}: {
  description: string;
  setDescription: (s: string) => void;
  draft: Draft;
  streaming: boolean;
}) {
  const fields: FieldKey[] = ["title", "whenHint", "estimatedMinutes", "stress", "exhaustion", "importance", "urgency", "repeat"];
  return (
    <div className="grid md:grid-cols-[1.4fr_1fr] gap-5">
      <div className="grid gap-1.5 min-h-0">
        <Label htmlFor="wiz-desc" className="text-xs text-muted-foreground">What's on your mind?</Label>
        <Textarea
          id="wiz-desc"
          autoFocus
          placeholder={"Just describe it. 'Finish the Q3 deck — 4 slides left, due Friday.'\n\nThe AI fills in everything else."}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[300px] resize-none text-sm"
        />
      </div>
      <div className="grid gap-2 content-start">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3.5" />
          AI confidence
          {streaming && <span className="text-amber-500">reading…</span>}
        </div>
        <div className="grid gap-1 mt-1 rounded-lg border bg-card p-3">
          {fields.map((f) => {
            const d = (draft as Record<FieldKey, { value: unknown; confidence: number | null }>)[f];
            const band = confidenceBand(d.confidence);
            return (
              <div key={f} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
                <span className={cn("size-2 rounded-full shrink-0", bandColor(band))} />
                <span className="text-muted-foreground">{FIELD_LABEL[f]}</span>
                <span className="font-mono tabular-nums text-foreground/80 truncate max-w-[8rem]">
                  {formatValue(f, d.value)}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground italic mt-1">
          Green: high confidence. Yellow/red: you'll get a chance to confirm next step.
        </p>
      </div>
    </div>
  );
}

function ClarifyStep({
  fields,
  draft,
  onUpdate,
}: {
  fields: FieldKey[];
  draft: Draft;
  onUpdate: (field: FieldKey, value: unknown) => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        I'm not sure about these. Quick check — answer or leave the AI's guess:
      </p>
      {fields.map((f) => {
        const d = (draft as Record<FieldKey, { value: unknown; confidence: number | null }>)[f];
        return (
          <div key={f} className="grid gap-2">
            <Label className="text-sm font-medium">{CLARIFY_PROMPTS[f]}</Label>
            {renderClarifyInput(f, d.value, (v) => onUpdate(f, v))}
            <p className="text-[10px] text-muted-foreground">AI guessed: <span className="font-mono">{formatValue(f, d.value)}</span></p>
          </div>
        );
      })}
    </div>
  );
}

function renderClarifyInput(field: FieldKey, value: unknown, onChange: (v: unknown) => void) {
  if (field === "repeat") {
    return (
      <select
        value={value as string}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-md border border-input bg-transparent px-2 text-sm"
      >
        {REPEAT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  if (field === "whenHint") {
    const opts = [
      { v: "asap", l: "ASAP" },
      { v: "this_week", l: "This week" },
      { v: "this_month", l: "This month" },
      { v: "no_rush", l: "No rush" },
    ];
    return (
      <div className="inline-flex rounded-lg border p-0.5">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={cn(
              "px-3 py-1 text-xs rounded-md transition-colors",
              value === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.l}
          </button>
        ))}
      </div>
    );
  }
  if (field === "title") {
    return (
      <Input value={value as string} onChange={(e) => onChange(e.target.value)} className="h-10" />
    );
  }
  // numeric
  return (
    <Input
      type="number"
      value={value == null ? "" : String(value)}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        onChange(Number.isFinite(n) ? n : null);
      }}
      className="h-10 max-w-[10rem]"
      min={field === "estimatedMinutes" ? 5 : 0}
      max={field === "estimatedMinutes" ? 720 : 10}
    />
  );
}

function ConfirmStep({
  title, setTitle,
  draft, setDraft,
  whenMode, setWhenMode,
  startDate, setStartDate,
  startTime, setStartTime,
  endDate, setEndDate,
  endTime, setEndTime,
  tagIds, setTagIds,
  forceManual,
}: {
  title: string;
  setTitle: (s: string) => void;
  draft: Draft;
  setDraft: (d: Draft | ((prev: Draft) => Draft)) => void;
  whenMode: "auto" | "manual";
  setWhenMode: (m: "auto" | "manual") => void;
  startDate: string; setStartDate: (s: string) => void;
  startTime: string; setStartTime: (s: string) => void;
  endDate: string; setEndDate: (s: string) => void;
  endTime: string; setEndTime: (s: string) => void;
  tagIds: string[];
  setTagIds: (ids: string[]) => void;
  forceManual: boolean;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="wiz-title" className="text-xs text-muted-foreground">Title</Label>
        <Input id="wiz-title" value={title} onChange={(e) => setTitle(e.target.value)} className="h-10" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">When</Label>
          <div className="inline-flex rounded-lg border p-0.5 w-full">
            <button
              type="button"
              disabled={forceManual}
              onClick={() => setWhenMode("auto")}
              className={cn(
                "flex-1 px-2 py-1 text-xs rounded-md",
                whenMode === "auto" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                forceManual && "opacity-50 cursor-not-allowed",
              )}
            >
              Find a spot
            </button>
            <button
              type="button"
              onClick={() => setWhenMode("manual")}
              className={cn(
                "flex-1 px-2 py-1 text-xs rounded-md",
                whenMode === "manual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Pick a time
            </button>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="wiz-repeat" className="text-xs text-muted-foreground">Repeats</Label>
          <select
            id="wiz-repeat"
            value={draft.repeat.value}
            onChange={(e) => setDraft((d) => ({ ...d, repeat: { value: e.target.value as Repeat, confidence: 1 } }))}
            className="h-10 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {REPEAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {whenMode === "manual" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid grid-cols-[1fr_auto] gap-1.5 items-end">
            <div className="grid gap-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Starts</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9" />
            </div>
            <Input aria-label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-9 w-24" />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-1.5 items-end">
            <div className="grid gap-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Ends</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9" />
            </div>
            <Input aria-label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-9 w-24" />
          </div>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">Tags <span className="text-[10px] italic">(color the block)</span></Label>
        <TagPicker value={tagIds} onChange={setTagIds} placeholder="Tag this event…" />
      </div>

      <details className="rounded-lg border bg-muted/30 p-3">
        <summary className="text-xs font-medium uppercase tracking-wider text-muted-foreground cursor-pointer">
          AI-inferred metrics
        </summary>
        <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
          {(["estimatedMinutes", "stress", "exhaustion", "importance", "urgency"] as MetricKey[]).map((k) => (
            <label key={k} className="grid grid-cols-[1fr_5rem] items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{FIELD_LABEL[k]}</span>
              <Input
                type="number"
                value={draft[k].value == null ? "" : String(draft[k].value)}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setDraft((d) => ({ ...d, [k]: { value: Number.isFinite(n) ? n : null, confidence: 1 } }));
                }}
                className="h-8"
              />
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

function formatValue(field: FieldKey, v: unknown): string {
  if (v == null || v === "") return "—";
  if (field === "estimatedMinutes" && typeof v === "number") return `${v}m`;
  if (field === "repeat" && typeof v === "string") return v === "none" ? "once" : v;
  if (field === "whenHint" && typeof v === "string") return v.replace(/_/g, " ");
  if (typeof v === "string") return v.length > 24 ? `${v.slice(0, 24)}…` : v;
  return String(v);
}

function toTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function combine(dateStr: string, timeStr: string): Date | null {
  const d = inputValueToDate(dateStr);
  if (!d) return null;
  const [h, m] = timeStr.split(":").map(Number);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}
