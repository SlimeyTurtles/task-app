"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

// Mirror of the server-side defaults — duplicated intentionally so the
// form has something to render before the query resolves. Server is the
// source of truth on save.
const DEFAULTS = {
  workStartHour: 8,
  workEndHour: 22,
  slotStepMin: 15,
  respectTimeBlocks: true,
  horizonDays: 21,
};

const STEP_OPTIONS = [5, 10, 15, 30, 60] as const;

function fmtHour(h: number): string {
  const n = ((h - 1) % 12) + 1;
  const ampm = h < 12 || h === 24 ? (h === 0 || h === 24 ? "midnight" : "AM") : h === 12 ? "noon" : "PM";
  if (h === 0 || h === 24) return "12 midnight";
  if (h === 12) return "12 noon";
  return `${n} ${ampm}`;
}

export function SchedulingSettingsClient() {
  const utils = trpc.useUtils();
  const { data: settings, isLoading } = trpc.settings.get.useQuery();
  const update = trpc.settings.update.useMutation({
    onSuccess: () => {
      void utils.settings.get.invalidate();
      toast.success("Saved.");
    },
    onError: (e) => toast.error(`Couldn't save: ${e.message}`),
  });

  const [workStartHour, setWorkStartHour] = useState(DEFAULTS.workStartHour);
  const [workEndHour, setWorkEndHour] = useState(DEFAULTS.workEndHour);
  const [slotStepMin, setSlotStepMin] = useState<number>(DEFAULTS.slotStepMin);
  const [respectTimeBlocks, setRespectTimeBlocks] = useState(DEFAULTS.respectTimeBlocks);
  const [horizonDays, setHorizonDays] = useState(DEFAULTS.horizonDays);

  // Hydrate when the query resolves. We don't want to overwrite local
  // edits on a refetch, so this only runs once after first data arrival.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated || !settings) return;
    const s = settings.scheduling;
    if (s?.workStartHour != null) setWorkStartHour(s.workStartHour);
    if (s?.workEndHour != null) setWorkEndHour(s.workEndHour);
    if (s?.slotStepMin != null) setSlotStepMin(s.slotStepMin);
    if (s?.respectTimeBlocks != null) setRespectTimeBlocks(s.respectTimeBlocks);
    if (s?.horizonDays != null) setHorizonDays(s.horizonDays);
    setHydrated(true);
  }, [settings, hydrated]);

  function save() {
    if (workEndHour <= workStartHour) {
      toast.error("End hour must be after start hour.");
      return;
    }
    update.mutate({
      scheduling: {
        workStartHour,
        workEndHour,
        slotStepMin: slotStepMin as 5 | 10 | 15 | 30 | 60,
        respectTimeBlocks,
        horizonDays,
      },
    });
  }

  return (
    <div className="p-6 max-w-2xl grid gap-6">
      <div>
        <h1 className="font-heading text-2xl tracking-tight">Find a spot</h1>
        <p className="text-sm text-muted-foreground mt-1">
          How the auto-scheduler picks slots when you quick-add an event or
          run AI schedule on an inbox task.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Working window</CardTitle>
          <CardDescription>
            The scheduler will only place tasks between these hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Earliest start</span>
              <Input
                type="number"
                min={0}
                max={23}
                value={workStartHour}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) setWorkStartHour(Math.max(0, Math.min(23, n)));
                }}
              />
              <span className="text-[10px] text-muted-foreground">
                {fmtHour(workStartHour)} local
              </span>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Latest end</span>
              <Input
                type="number"
                min={1}
                max={24}
                value={workEndHour}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) setWorkEndHour(Math.max(1, Math.min(24, n)));
                }}
              />
              <span className="text-[10px] text-muted-foreground">
                {fmtHour(workEndHour)} local
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Time blocks</CardTitle>
          <CardDescription>
            Treat your background time blocks (sleep, focus, work hours,
            commute, …) as busy. Doesn't affect blocks you've marked
            "schedulable on top."
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Respect time blocks</span>
            <Switch
              checked={respectTimeBlocks}
              onCheckedChange={(v) => setRespectTimeBlocks(Boolean(v))}
            />
          </label>
          <p className="text-[11px] text-muted-foreground mt-2">
            Manage individual blocks at{" "}
            <Link href="/settings/time-blocks" className="underline">
              Time blocks
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resolution</CardTitle>
          <CardDescription>
            How fine-grained the scheduler's search is.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label className="text-xs text-muted-foreground">Slot step</Label>
            <div className="inline-flex rounded-lg border p-0.5 w-fit">
              {STEP_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSlotStepMin(s)}
                  className={cn(
                    "px-3 py-1 text-xs rounded-md transition-colors",
                    slotStepMin === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s} min
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">
              Smaller = the scheduler can find tighter gaps, but the
              search takes longer.
            </span>
          </div>

          <label className="grid gap-1.5 max-w-[10rem]">
            <span className="text-xs text-muted-foreground">Look-ahead (days)</span>
            <Input
              type="number"
              min={1}
              max={60}
              value={horizonDays}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setHorizonDays(Math.max(1, Math.min(60, n)));
              }}
            />
            <span className="text-[11px] text-muted-foreground">
              If nothing fits in this window, the scheduler falls back to
              the earliest slot regardless of conflicts.
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button onClick={save} disabled={isLoading || update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
