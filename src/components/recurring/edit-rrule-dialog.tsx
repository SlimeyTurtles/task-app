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
import { RecurrenceEditor } from "@/components/recurring/recurrence-editor";
import { buildRrule, parseRrule, type RecurrencePattern } from "@/lib/recurrence";

type Rule = {
  id: string;
  rrule: string;
  timezone: string;
  dtstart: Date;
};

export function EditRruleDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [pattern, setPattern] = useState<RecurrencePattern | null>(null);
  const [raw, setRaw] = useState("");
  const [rawMode, setRawMode] = useState(false);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    if (!rule) return;
    const parsed = parseRrule(rule.rrule, rule.timezone);
    setPattern(parsed);
    setRawMode(parsed == null); // unrepresentable rules open straight in the power editor
    setRaw(rule.rrule);
    setTimezone(rule.timezone);
  }, [rule]);

  const upsert = trpc.recurrence.upsert.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.recurrence.list.invalidate(), utils.events.list.invalidate()]);
      toast.success("Recurrence updated.");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  async function onSave() {
    if (!rule) return;
    const tz = timezone.trim() || "UTC";
    if (rawMode) {
      if (!raw.trim()) {
        toast.error("Provide an RRULE.");
        return;
      }
      upsert.mutate({ ruleId: rule.id, rrule: raw.trim(), timezone: tz });
    } else {
      if (!pattern) {
        toast.error("Pick a repeat pattern (or delete the rule instead).");
        return;
      }
      upsert.mutate({ ruleId: rule.id, pattern, timezone: tz });
    }
  }

  return (
    <Dialog open={rule != null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit recurrence</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {!rawMode ? (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Repeats</Label>
              <RecurrenceEditor
                value={pattern}
                onChange={setPattern}
                anchor={rule ? new Date(rule.dtstart) : new Date()}
                selectId="rule-repeat"
              />
            </div>
          ) : null}

          <details
            open={rawMode}
            onToggle={(e) => setRawMode((e.target as HTMLDetailsElement).open)}
          >
            <summary className="text-xs font-medium uppercase tracking-wider text-muted-foreground cursor-pointer">
              Power editor
            </summary>
            <div className="grid gap-3 mt-2">
              <div className="grid gap-1.5">
                <Label htmlFor="rrule-raw" className="text-xs text-muted-foreground">Raw RRULE</Label>
                <Input
                  id="rrule-raw"
                  value={rawMode ? raw : pattern ? buildRrule(pattern, rule ? new Date(rule.dtstart) : new Date(), timezone) : ""}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
                  className="font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  iCal RRULE without the <code>RRULE:</code> prefix. Open = the raw string wins.
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
          </details>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={upsert.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
