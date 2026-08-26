"use client";

import { Repeat } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EditScope } from "@/lib/series-edit";

export type { EditScope };

export function EditScopeDialog({
  open,
  mode,
  isFirst,
  onPick,
  onCancel,
}: {
  open: boolean;
  mode: "edit" | "delete";
  /** The series anchor — "this and following" would equal "all", so hide it. */
  isFirst: boolean;
  onPick: (scope: EditScope) => void;
  onCancel: () => void;
}) {
  const verb = mode === "delete" ? "Delete" : "Change";
  const options: { scope: EditScope; label: string; hint: string }[] = [
    {
      scope: "this",
      label: "Only this event",
      hint:
        mode === "delete"
          ? "Remove this occurrence; the rest of the series stays."
          : "This occurrence becomes its own thing; the series is untouched.",
    },
    ...(!isFirst
      ? [
          {
            scope: "following" as EditScope,
            label: "This and following events",
            hint:
              mode === "delete"
                ? "End the series here; earlier occurrences stay."
                : "Split the series here; earlier occurrences keep the old shape.",
          },
        ]
      : []),
    {
      scope: "all",
      label: "All events",
      hint:
        mode === "delete"
          ? "Remove the whole series (completed work is kept)."
          : "Apply to every occurrence in the series.",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onCancel())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="size-4 text-primary" aria-hidden />
            {verb} recurring event
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          {options.map((o) => (
            <button
              key={o.scope}
              type="button"
              onClick={() => onPick(o.scope)}
              className="rounded-lg border px-3 py-2.5 text-left hover:border-primary/60 hover:bg-primary/[0.04] transition-colors"
            >
              <p className="text-sm font-medium">{o.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{o.hint}</p>
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={onCancel} className="justify-self-end">
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  );
}
