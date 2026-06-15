"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc/client";

const LEAD_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: "15 minutes" },
  { value: 60, label: "1 hour" },
  { value: 4 * 60, label: "4 hours" },
  { value: 24 * 60, label: "24 hours" },
  { value: 3 * 24 * 60, label: "3 days" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`,
}));

export function NotificationsSettingsClient() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.notifications.getPreferences.useQuery();
  const update = trpc.notifications.updatePreferences.useMutation({
    onSuccess: () => {
      void utils.notifications.getPreferences.invalidate();
      toast.success("Saved.");
    },
    onError: (e) => toast.error(`Couldn't save: ${e.message}`),
  });
  const dispatchNow = trpc.notifications.dispatchNow.useMutation({
    onSuccess: ({ created }) => {
      void utils.notifications.unread.invalidate();
      toast.success(`Checked: ${created} new notification${created === 1 ? "" : "s"}.`);
    },
    onError: (e) => toast.error(e.message),
  });

  const [enabled, setEnabled] = useState(true);
  const [leadMinutes, setLeadMinutes] = useState(24 * 60);
  const [quietStartHour, setQuietStartHour] = useState(22);
  const [quietEndHour, setQuietEndHour] = useState(7);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setLeadMinutes(data.leadMinutes);
    setQuietStartHour(data.quietStartHour);
    setQuietEndHour(data.quietEndHour);
    setTimezone(data.timezone);
  }, [data]);

  function onSave() {
    update.mutate({ enabled, leadMinutes, quietStartHour, quietEndHour, timezone });
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="grid gap-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Due-date alerts</CardTitle>
          <CardDescription>In-app notifications for tasks approaching their due date.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="text-sm font-medium block">Enabled</span>
              <span className="text-xs text-muted-foreground">Turn off to silence all due-date notifications.</span>
            </span>
            <Switch checked={enabled} onCheckedChange={(v) => setEnabled(Boolean(v))} />
          </label>

          <div className="grid gap-1.5">
            <Label htmlFor="lead">Notify me when due in</Label>
            <select
              id="lead"
              value={leadMinutes}
              onChange={(e) => setLeadMinutes(parseInt(e.target.value, 10))}
              disabled={!enabled}
              className="h-10 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-60"
            >
              {LEAD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Tasks crossing into this window trigger a notification on the next 5-minute tick.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quiet hours</CardTitle>
          <CardDescription>Notifications wait until quiet hours end.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="quiet-start">From</Label>
              <select
                id="quiet-start"
                value={quietStartHour}
                onChange={(e) => setQuietStartHour(parseInt(e.target.value, 10))}
                disabled={!enabled}
                className="h-10 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-60"
              >
                {HOUR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="quiet-end">To</Label>
              <select
                id="quiet-end"
                value={quietEndHour}
                onChange={(e) => setQuietEndHour(parseInt(e.target.value, 10))}
                disabled={!enabled}
                className="h-10 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-60"
              >
                {HOUR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-1.5">
            Set start = end to disable quiet hours.
          </p>

          <div className="grid gap-1.5">
            <Label htmlFor="tz">Timezone</Label>
            <input
              id="tz"
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              disabled={!enabled}
              placeholder="UTC"
              className="h-10 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-60"
            />
            <p className="text-xs text-muted-foreground">IANA tz id (e.g. America/Los_Angeles).</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={onSave} disabled={update.isPending}>Save</Button>
        <Button variant="outline" onClick={() => dispatchNow.mutate()} disabled={dispatchNow.isPending}>
          Check now
        </Button>
      </div>
    </div>
  );
}
