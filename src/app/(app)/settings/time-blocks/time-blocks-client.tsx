"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { TimeBlockKind } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { addDays, startOfLocalDay, endOfLocalDay, formatDayLabel, formatTime } from "@/lib/scheduling";
import { repeatLabel } from "@/lib/recurrence";
import { TimeBlockFormDialog, type TimeBlockInit } from "@/components/time-blocks/time-block-form-dialog";

type Block = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  kind: TimeBlockKind;
  label: string | null;
  schedulableOnTop: boolean;
  rrule: string | null;
};

export function TimeBlocksClient() {
  const today = startOfLocalDay(new Date());
  const start = addDays(today, -60);
  const end = endOfLocalDay(addDays(today, 60));

  const { data: blocks, isLoading } = trpc.timeBlocks.list.useQuery({ start, end });
  const [dialog, setDialog] = useState<{ open: boolean; block?: TimeBlockInit | null }>({ open: false });

  const { recurring, oneOff } = useMemo(() => {
    const list = (blocks ?? []) as Block[];
    const recurring = list
      .filter((b) => b.rrule)
      .sort((a, b) => minutesOfDay(a.startsAt) - minutesOfDay(b.startsAt));
    const oneOff = list
      .filter((b) => !b.rrule)
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
    return { recurring, oneOff };
  }, [blocks]);

  function openEdit(b: Block) {
    setDialog({
      open: true,
      block: {
        id: b.id,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        kind: b.kind,
        label: b.label,
        schedulableOnTop: b.schedulableOnTop,
        rrule: b.rrule,
      },
    });
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setDialog({ open: true, block: null })}>
          <Plus className="size-4" /> New time block
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground mt-6">Loading…</p>
      ) : recurring.length === 0 && oneOff.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-6">
          No time blocks yet. Add sleep, work hours, commute, or any recurring background time the
          scheduler should respect.
        </p>
      ) : (
        <div className="mt-6 grid gap-6 max-w-2xl">
          {recurring.length > 0 ? (
            <BlockGroup
              title="Routine"
              subtitle="Repeating blocks"
              blocks={recurring}
              recurring
              onEdit={openEdit}
            />
          ) : null}
          {oneOff.length > 0 ? (
            <BlockGroup title="One-off" subtitle="Specific dates" blocks={oneOff} onEdit={openEdit} />
          ) : null}
        </div>
      )}

      <TimeBlockFormDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((s) => ({ ...s, open }))}
        block={dialog.block}
      />
    </>
  );
}

function BlockGroup({
  title,
  subtitle,
  blocks,
  recurring,
  onEdit,
}: {
  title: string;
  subtitle: string;
  blocks: Block[];
  recurring?: boolean;
  onEdit: (b: Block) => void;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
      <Card className="divide-y p-0 overflow-hidden">
        {blocks.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onEdit(b)}
            className="group w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-accent/40 transition-colors"
          >
            <span className={cn("size-2.5 rounded-full shrink-0", dotClass(b.kind))} />
            <span className="text-sm font-medium min-w-0 truncate">{b.label || prettyKind(b.kind)}</span>
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
              {recurring
                ? `${formatTime(b.startsAt)} – ${formatTime(b.endsAt)}`
                : `${formatDayLabel(b.startsAt)} · ${formatTime(b.startsAt)} – ${formatTime(b.endsAt)}`}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              {recurring ? (
                <Badge variant="secondary" className="font-normal">
                  {repeatLabel(b.rrule)}
                </Badge>
              ) : null}
              {b.schedulableOnTop ? (
                <Badge variant="outline" className="font-normal">
                  overlayable
                </Badge>
              ) : null}
              <Pencil className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </div>
          </button>
        ))}
      </Card>
    </section>
  );
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
function prettyKind(k: TimeBlockKind): string {
  return k.charAt(0) + k.slice(1).toLowerCase().replace("_", " ");
}
function dotClass(k: TimeBlockKind): string {
  switch (k) {
    case TimeBlockKind.SLEEP: return "bg-indigo-500";
    case TimeBlockKind.WORK_HOURS: return "bg-amber-500";
    case TimeBlockKind.FOCUS: return "bg-emerald-500";
    case TimeBlockKind.REST: return "bg-sky-500";
    case TimeBlockKind.COMMUTE: return "bg-rose-500";
    case TimeBlockKind.MEAL: return "bg-orange-500";
    default: return "bg-muted-foreground/50";
  }
}
