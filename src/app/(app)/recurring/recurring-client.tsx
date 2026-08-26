"use client";

import { useState } from "react";
import Link from "next/link";
import { BellRing, Pause, Pencil, Play, PlayCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { RotatingTagline } from "@/components/app/rotating-tagline";
import { describeRrule } from "@/lib/recurrence";
import { EditRruleDialog } from "@/components/recurring/edit-rrule-dialog";
import { DeleteRuleDialog } from "@/components/recurring/delete-rule-dialog";

const RECURRING_EMPTY = [
  "No recurring templates. Mireille just makes the same dough on instinct.",
  "Empty. Bartholomew lives the same Tuesday over and over without a template.",
  "No recurrences. Wendell's fortune cookies say 'tomorrow' every day.",
  "Empty. Gertrude reschedules the séance by mood.",
  "No templates. Esmeralda's only ritual is 'whatever the cat does.'",
];

type ListItem = {
  id: string;
  taskId: string | null;
  rrule: string;
  timezone: string;
  dtstart: Date;
  nextMaterializeAt: Date | null;
  task: {
    id: string;
    name: string;
    dueDate: Date | null;
    area: { id: string; name: string; color: string | null } | null;
  } | null;
  templateEvent: { id: string; title: string | null; startsAt: Date; kind: string } | null;
};

export function RecurringClient() {
  const utils = trpc.useUtils();
  const { data: rules, isLoading } = trpc.recurrence.list.useQuery();
  const [editing, setEditing] = useState<ListItem | null>(null);
  const [deleting, setDeleting] = useState<ListItem | null>(null);

  const pause = trpc.recurrence.pause.useMutation({
    onSuccess: () => utils.recurrence.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const resume = trpc.recurrence.resume.useMutation({
    onSuccess: () =>
      Promise.all([utils.recurrence.list.invalidate(), utils.events.list.invalidate()]),
    onError: (e) => toast.error(e.message),
  });
  const materialize = trpc.recurrence.materializeNow.useMutation({
    onSuccess: ({ rules, events, tasks }) => {
      toast.success(
        `Materialized ${events} event${events === 1 ? "" : "s"} and ${tasks} task${tasks === 1 ? "" : "s"} across ${rules} rule${rules === 1 ? "" : "s"}.`,
      );
      void utils.tasks.list.invalidate();
      void utils.events.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Add a Repeats option on any new event in the calendar to start a series.
        </p>
        <Button size="sm" variant="outline" onClick={() => materialize.mutate()}>
          <PlayCircle className="size-4" /> Run materializer
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground mt-6">Loading templates…</p>
      ) : rules && rules.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {rules.map((rule) => {
            const paused = rule.nextMaterializeAt == null;
            const name = rule.task?.name ?? rule.templateEvent?.title ?? "Untitled series";
            const isReminder = rule.templateEvent?.kind === "REMINDER";
            return (
              <Card key={rule.id} className={paused ? "opacity-70" : undefined}>
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div className="min-w-0 flex items-start gap-2">
                    {rule.task?.area?.color ? (
                      <span
                        className="mt-1 size-3 rounded-full shrink-0"
                        style={{ backgroundColor: rule.task.area.color }}
                      />
                    ) : null}
                    <div className="min-w-0">
                      <CardTitle className="truncate flex items-center gap-1.5">
                        {isReminder ? <BellRing className="size-3.5 text-primary shrink-0" /> : null}
                        {rule.taskId ? (
                          <Link href={`/tasks?id=${rule.taskId}`} className="hover:underline truncate">
                            {name}
                          </Link>
                        ) : (
                          <span className="truncate">{name}</span>
                        )}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        {describeRrule(rule.rrule)}
                        {rule.task?.area ? ` · ${rule.task.area.name}` : ""}
                        {paused ? " · paused" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(rule)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => (paused ? resume : pause).mutate({ ruleId: rule.id })}
                    >
                      {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(rule)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  <PreviewList ruleId={rule.id} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="py-6 text-center grid gap-1.5 mt-2">
          <p className="font-heading text-lg tracking-tight">
            <RotatingTagline taglines={RECURRING_EMPTY} />
          </p>
          <p className="text-xs text-muted-foreground">
            Open the calendar, drag to create an event, and pick a Repeats option.
          </p>
        </div>
      )}

      <EditRruleDialog
        rule={editing}
        onClose={() => setEditing(null)}
      />
      <DeleteRuleDialog
        rule={deleting}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

function PreviewList({ ruleId }: { ruleId: string }) {
  const { data, isLoading } = trpc.recurrence.preview.useQuery({ ruleId, count: 5 });
  if (isLoading) return <p>Loading next dates…</p>;
  if (!data || data.length === 0) return <p>No upcoming occurrences.</p>;
  return (
    <div className="grid gap-0.5">
      <p className="uppercase tracking-wider text-[10px] text-muted-foreground/70 mb-0.5">Next 5</p>
      {data.map((d) => (
        <span key={d.toISOString()} className="tabular-nums">
          {new Date(d).toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      ))}
    </div>
  );
}
