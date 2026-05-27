"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { TimeBlockKind } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { addDays, startOfLocalDay, endOfLocalDay, formatDayLabel, formatTime } from "@/lib/scheduling";
import { TimeBlockFormDialog, type TimeBlockInit } from "@/components/time-blocks/time-block-form-dialog";

export function TimeBlocksClient() {
  // Show ±60 days from today.
  const today = startOfLocalDay(new Date());
  const start = addDays(today, -60);
  const end = endOfLocalDay(addDays(today, 60));

  const { data: blocks, isLoading } = trpc.timeBlocks.list.useQuery({ start, end });
  const [dialog, setDialog] = useState<{ open: boolean; block?: TimeBlockInit | null }>({ open: false });

  const sorted = useMemo(() => {
    return [...(blocks ?? [])].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  }, [blocks]);

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setDialog({ open: true, block: null })}>
          <Plus className="size-4" /> New time block
        </Button>
      </div>

      <div className="mt-6 grid gap-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No time blocks. Add sleep, work hours, commute, or any recurring background
            time the scheduler should respect.
          </p>
        ) : (
          sorted.map((b) => (
            <Card key={b.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{b.label || prettyKind(b.kind)}</span>
                  <Badge variant="outline">{prettyKind(b.kind)}</Badge>
                  {b.schedulableOnTop ? (
                    <Badge variant="secondary">schedulable on top</Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {formatDayLabel(b.startsAt)} {formatTime(b.startsAt)} → {formatDayLabel(b.endsAt)} {formatTime(b.endsAt)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setDialog({
                    open: true,
                    block: {
                      id: b.id,
                      startsAt: b.startsAt,
                      endsAt: b.endsAt,
                      kind: b.kind,
                      label: b.label,
                      schedulableOnTop: b.schedulableOnTop,
                    },
                  })
                }
              >
                <Pencil className="size-4" />
              </Button>
            </Card>
          ))
        )}
      </div>

      <TimeBlockFormDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((s) => ({ ...s, open }))}
        block={dialog.block}
      />
    </>
  );
}

function prettyKind(k: TimeBlockKind): string {
  return k.toLowerCase().replace("_", " ");
}
