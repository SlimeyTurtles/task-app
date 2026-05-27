"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc/client";
import type { RecoveryRule } from "@/lib/recommendation";

export function CapacityClient() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.capacity.get.useQuery();
  const update = trpc.capacity.update.useMutation({
    onSuccess: () => {
      void utils.capacity.get.invalidate();
      toast.success("Capacity saved.");
    },
    onError: (e) => toast.error(e.message),
  });

  const [stress, setStress] = useState(0);
  const [exhaustion, setExhaustion] = useState(0);
  const [focusedHours, setFocusedHours] = useState(0);
  const [rules, setRules] = useState<RecoveryRule[]>([]);

  useEffect(() => {
    if (!data) return;
    setStress(data.dailyStressBudget);
    setExhaustion(data.dailyExhaustionBudget);
    setFocusedHours(data.dailyFocusedHours);
    const raw = (data.recoveryRules as unknown) ?? [];
    setRules(Array.isArray(raw) ? (raw as RecoveryRule[]) : []);
  }, [data]);

  function addRule() {
    setRules((r) => [
      ...r,
      { kind: "cooldown_after_exhaustion", thresholdExhaustion: 8, cooldownHours: 12 },
    ]);
  }
  function updateRule(idx: number, patch: Partial<RecoveryRule>) {
    setRules((r) => r.map((rule, i) => (i === idx ? { ...rule, ...patch } : rule)));
  }
  function removeRule(idx: number) {
    setRules((r) => r.filter((_, i) => i !== idx));
  }

  function save() {
    update.mutate({
      dailyStressBudget: stress,
      dailyExhaustionBudget: exhaustion,
      dailyFocusedHours: focusedHours,
      recoveryRules: rules,
    });
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading capacity model…</p>;

  return (
    <div className="grid gap-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Daily budgets</CardTitle>
          <CardDescription>
            The recommendation engine refuses to schedule more than this on any one day.
            Calibration will refine these over time once Phase 5 lands.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-3 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="cap-stress">Stress (sum of task stress)</Label>
            <Input
              id="cap-stress"
              type="number"
              min={0}
              max={500}
              value={stress}
              onChange={(e) => setStress(Number(e.target.value))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cap-exh">Exhaustion (sum)</Label>
            <Input
              id="cap-exh"
              type="number"
              min={0}
              max={500}
              value={exhaustion}
              onChange={(e) => setExhaustion(Number(e.target.value))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cap-hours">Focused hours</Label>
            <Input
              id="cap-hours"
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={focusedHours}
              onChange={(e) => setFocusedHours(Number(e.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recovery rules</CardTitle>
          <CardDescription>
            After a high-exhaustion task, the scheduler holds the next slot until the
            cool-down has passed. Add rules to enforce this.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recovery rules. Click below to add one.</p>
          ) : (
            rules.map((rule, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <div className="grid gap-2">
                  <Label htmlFor={`rule-th-${idx}`}>Exhaustion ≥</Label>
                  <Input
                    id={`rule-th-${idx}`}
                    type="number"
                    min={0}
                    max={10}
                    value={rule.thresholdExhaustion}
                    onChange={(e) => updateRule(idx, { thresholdExhaustion: Number(e.target.value) })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`rule-cd-${idx}`}>Cool-down (hours)</Label>
                  <Input
                    id={`rule-cd-${idx}`}
                    type="number"
                    min={1}
                    max={72}
                    value={rule.cooldownHours}
                    onChange={(e) => updateRule(idx, { cooldownHours: Number(e.target.value) })}
                  />
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeRule(idx)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
          <Button variant="outline" onClick={addRule}>
            <Plus className="size-4" /> Add rule
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save capacity"}
        </Button>
      </div>
    </div>
  );
}
