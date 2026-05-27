"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalibrationDimension } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc/client";
import { addDays, startOfLocalDay, endOfLocalDay } from "@/lib/scheduling";

const RANGE_OPTIONS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

export function MetricsClient() {
  const [rangeDays, setRangeDays] = useState(30);
  const [groupBy, setGroupBy] = useState<"area" | "project" | "tag">("area");

  const today = startOfLocalDay(new Date());
  const start = addDays(today, -(rangeDays - 1));
  const end = endOfLocalDay(today);

  const utils = trpc.useUtils();
  const recalibrate = trpc.calibration.recalibrate.useMutation({
    onSuccess: ({ rowsWritten }) => {
      toast.success(`Recalibrated. ${rowsWritten} multiplier row${rowsWritten === 1 ? "" : "s"} written.`);
      void utils.metrics.accuracy.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const breakdown = trpc.metrics.breakdown.useQuery({ start, end, groupBy });
  const capacity = trpc.metrics.capacityTrend.useQuery({ start, end });
  const accuracy = trpc.metrics.accuracy.useQuery();

  const breakdownData = useMemo(
    () =>
      (breakdown.data ?? []).slice(0, 12).map((b) => ({
        name: b.name,
        minutes: Math.round(b.minutes),
        fill: b.color ?? "var(--primary)",
      })),
    [breakdown.data],
  );

  const trendData = useMemo(
    () =>
      (capacity.data ?? []).map((d) => ({
        day: new Date(d.dayKey).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        stress: Math.round(d.stress),
        exhaustion: Math.round(d.exhaustion),
        minutes: Math.round(d.minutes),
      })),
    [capacity.data],
  );

  return (
    <div className="grid gap-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="range">Range</Label>
            <select
              id="range"
              value={rangeDays}
              onChange={(e) => setRangeDays(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.days} value={o.days}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="group">Group time by</Label>
            <select
              id="group"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as "area" | "project" | "tag")}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="area">Area</option>
              <option value="project">Project</option>
              <option value="tag">Tag</option>
            </select>
          </div>
        </div>
        <Button onClick={() => recalibrate.mutate()} disabled={recalibrate.isPending}>
          <Sparkles className="size-4" />
          {recalibrate.isPending ? "Recalibrating…" : "Recalibrate now"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Time spent by {groupBy}</CardTitle>
          <CardDescription>
            Confidence-weighted minutes from logged active events; background blocks excluded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {breakdownData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet — log some events to see breakdown.</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={breakdownData} layout="vertical" margin={{ left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(v) => `${v}m`} />
                <YAxis dataKey="name" type="category" width={140} />
                <Tooltip formatter={(v) => [`${v}m`, "minutes"]} />
                <Bar dataKey="minutes" radius={[4, 4, 4, 4]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capacity trend</CardTitle>
          <CardDescription>
            Daily totals so you can spot drift in your stress and exhaustion load.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trendData.every((d) => d.stress === 0 && d.exhaustion === 0 && d.minutes === 0) ? (
            <p className="text-sm text-muted-foreground">No data in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="stress" stroke="#f97316" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="exhaustion" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="minutes" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Estimate accuracy</CardTitle>
          <CardDescription>
            Learned multipliers from your completion history. Multiplier &gt; 1 means you
            underestimate; &lt; 1 means you overestimate. Confidence rises with samples.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!accuracy.data || accuracy.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No calibration data yet. Mark a few tasks done with actual metrics, then click
              <span className="font-medium">&quot;Recalibrate now&quot;</span>.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-4">Dimension</th>
                    <th className="py-2 pr-4">Segment</th>
                    <th className="py-2 pr-4">Multiplier</th>
                    <th className="py-2 pr-4">Samples</th>
                    <th className="py-2">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {accuracy.data.map((r) => (
                    <tr
                      key={`${r.dimension}-${r.segment}`}
                      className="border-b last:border-0"
                    >
                      <td className="py-2 pr-4">
                        <Badge variant="outline">{dimensionLabel(r.dimension)}</Badge>
                      </td>
                      <td className="py-2 pr-4">{r.segmentLabel}</td>
                      <td className="py-2 pr-4 font-mono">
                        <MultiplierBadge value={r.multiplier} />
                      </td>
                      <td className="py-2 pr-4">{r.samples}</td>
                      <td className="py-2">{Math.round(r.confidence * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function dimensionLabel(d: CalibrationDimension): string {
  switch (d) {
    case CalibrationDimension.TIME:
      return "Time";
    case CalibrationDimension.STRESS:
      return "Stress";
    case CalibrationDimension.EXHAUSTION:
      return "Exhaustion";
  }
}

function MultiplierBadge({ value }: { value: number }) {
  const direction =
    value > 1.1 ? "underestimate" : value < 0.9 ? "overestimate" : "on target";
  const color =
    value > 1.1
      ? "text-amber-600 dark:text-amber-400"
      : value < 0.9
      ? "text-sky-600 dark:text-sky-400"
      : "text-emerald-600 dark:text-emerald-400";
  return (
    <span className={color}>
      ×{value.toFixed(2)} <span className="text-xs text-muted-foreground">({direction})</span>
    </span>
  );
}
