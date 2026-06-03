"use client";

import { useMemo, useState } from "react";
import { Sparkles, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
import { formatDayLabel, formatTime } from "@/lib/scheduling";

export function PlanAheadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [horizon, setHorizon] = useState(14);
  const { data, isLoading, refetch, isFetching } = trpc.recommendations.suggest.useQuery(
    { horizonDays: horizon },
    { enabled: open },
  );

  const accept = trpc.recommendations.accept.useMutation({
    onSuccess: ({ created }) => {
      toast.success(`Accepted ${created} suggestion${created === 1 ? "" : "s"}.`);
      void utils.events.list.invalidate();
      void utils.tasks.list.invalidate();
      void refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const byDay = useMemo(() => {
    const m = new Map<string, typeof data extends { scheduled: infer S } ? S : never>();
    for (const s of data?.scheduled ?? []) {
      const key = s.day.toDateString();
      const cur = m.get(key) ?? ([] as never);
      (cur as unknown as { push: (s: unknown) => void }).push(s);
      m.set(key, cur);
    }
    return m;
  }, [data]);

  const allIds = useMemo(() => (data?.scheduled ?? []).map((s) => s.taskId), [data]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === allIds.length) setSelected(new Set());
    else setSelected(new Set(allIds));
  }

  function acceptSelected() {
    if (!data) return;
    const items = data.scheduled
      .filter((s) => selected.has(s.taskId))
      .map((s) => ({ taskId: s.taskId, startsAt: s.startsAt, endsAt: s.endsAt }));
    if (items.length === 0) {
      toast.error("Nothing selected.");
      return;
    }
    accept.mutate({ items });
    setSelected(new Set());
  }

  function acceptAll() {
    if (!data?.scheduled.length) return;
    accept.mutate({
      items: data.scheduled.map((s) => ({ taskId: s.taskId, startsAt: s.startsAt, endsAt: s.endsAt })),
    });
    setSelected(new Set());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5" /> Suggested plan
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="grid gap-2">
            <Label htmlFor="horizon">Horizon (days)</Label>
            <Input
              id="horizon"
              type="number"
              min={1}
              max={60}
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? "Recomputing…" : "Recompute"}
            </Button>
            <Button variant="outline" onClick={toggleAll} disabled={!allIds.length}>
              {selected.size === allIds.length ? "Deselect all" : "Select all"}
            </Button>
            <Button onClick={acceptSelected} disabled={selected.size === 0 || accept.isPending}>
              <Check className="size-4" /> Accept selected ({selected.size})
            </Button>
            <Button variant="default" onClick={acceptAll} disabled={!allIds.length || accept.isPending}>
              Accept all
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground mt-6">Computing suggestions…</p>
        ) : !data ? null : data.scheduled.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-6">
            Nothing to schedule — add tasks with time estimates, then try again.
          </p>
        ) : (
          <div className="mt-4 grid gap-4">
            {Array.from(byDay.entries()).map(([dayKey, items]) => {
              const day = new Date(dayKey);
              return (
                <div key={dayKey}>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">
                    {formatDayLabel(day)}
                  </h3>
                  <div className="grid gap-1.5">
                    {(items as Array<{
                      taskId: string;
                      startsAt: Date;
                      endsAt: Date;
                      reason: string;
                      task: { name: string };
                    }>).map((s) => {
                      const on = selected.has(s.taskId);
                      return (
                        <Card
                          key={s.taskId}
                          className={`px-3 py-2 flex items-start gap-3 cursor-pointer ${on ? "ring-2 ring-primary/40" : ""}`}
                          onClick={() => toggle(s.taskId)}
                        >
                          <Checkbox checked={on} className="mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{s.task.name}</span>
                              <Badge variant="outline" className="font-normal">
                                {formatTime(s.startsAt)} – {formatTime(s.endsAt)}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{s.reason}</p>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {data && data.skipped.length > 0 ? (
          <div className="mt-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <AlertCircle className="size-4" /> Not scheduled ({data.skipped.length})
            </h3>
            <div className="grid gap-1">
              {data.skipped.map((s) => (
                <div key={s.taskId} className="text-xs flex gap-2">
                  <span className="font-medium">{s.task.name}</span>
                  <span className="text-muted-foreground">— {s.reason}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
