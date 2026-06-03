"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ContextMenu as CtxPrimitive } from "@base-ui/react/context-menu";
import { Check, CheckCircle2, Circle, PencilLine, Plus, Search, Trash2, X } from "lucide-react";
import { TaskStatus } from "@prisma/client";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import type { GridEvent } from "@/components/calendar/time-grid";

/**
 * Right-click menu for an event. Hosts a task picker (the primary reason
 * the user wanted this) plus Edit / Delete. Keeps the menu open while
 * picking so the user can swap multiple tasks in one shot — closes on
 * outside click or pressing Escape.
 */
export function EventContextMenu({
  event,
  onEdit,
  children,
}: {
  event: GridEvent;
  onEdit: (eventId: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const utils = trpc.useUtils();
  const { data: tasks } = trpc.tasks.list.useQuery({}, { enabled: open });
  const updateEvent = trpc.events.update.useMutation();
  const delEvent = trpc.events.delete.useMutation();
  const markComplete = trpc.tasks.markComplete.useMutation();
  const updateTask = trpc.tasks.update.useMutation();

  const attachedIds = useMemo(
    () => event.attributions.map((a) => a.task.id),
    [event.attributions],
  );

  const filtered = useMemo(() => {
    if (!tasks) return [];
    const q = filter.trim().toLowerCase();
    return q
      ? tasks.filter((t) => t.name.toLowerCase().includes(q))
      : tasks;
  }, [tasks, filter]);

  async function saveAttributions(nextIds: string[]) {
    try {
      await updateEvent.mutateAsync({
        id: event.id,
        attributions: nextIds.map((id) => ({ taskId: id, weight: 1, ratioUnknown: false })),
      });
      await utils.events.list.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update event.");
    }
  }

  function toggle(taskId: string) {
    const next = attachedIds.includes(taskId)
      ? attachedIds.filter((id) => id !== taskId)
      : [...attachedIds, taskId];
    void saveAttributions(next);
  }

  async function toggleDone(taskId: string, currentlyDone: boolean) {
    try {
      if (currentlyDone) {
        // Un-mark: bump back to SCHEDULED. We leave the prior TaskCompletion
        // record in place — it's calibration data, fine to keep.
        await updateTask.mutateAsync({ id: taskId, status: TaskStatus.SCHEDULED });
      } else {
        await markComplete.mutateAsync({ id: taskId });
      }
      await Promise.all([utils.events.list.invalidate(), utils.tasks.list.invalidate()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update task.");
    }
  }

  async function onDelete() {
    if (!confirm("Delete this event?")) return;
    try {
      await delEvent.mutateAsync({ id: event.id });
      await utils.events.list.invalidate();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete.");
    }
  }

  return (
    <CtxPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setFilter("");
      }}
    >
      <CtxPrimitive.Trigger render={children as React.ReactElement} />
      <CtxPrimitive.Portal>
        <CtxPrimitive.Positioner sideOffset={4} className="z-50">
          <CtxPrimitive.Popup
            className={cn(
              "min-w-72 max-w-80 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md outline-none",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
              "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            )}
          >
            {/* Current attributions — checkbox toggles done, X detaches */}
            <div className="px-1 pb-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                Tasks
              </p>
              {event.attributions.length === 0 ? (
                <p className="text-xs text-muted-foreground italic px-1 py-0.5">
                  None — attach one below.
                </p>
              ) : (
                <div className="grid gap-0.5">
                  {event.attributions.map((a) => {
                    const taskDone = a.task.status === TaskStatus.DONE;
                    return (
                      <div
                        key={a.task.id}
                        className="group flex items-center gap-1.5 rounded-md px-1 py-1 hover:bg-accent/40"
                      >
                        <button
                          type="button"
                          onClick={() => toggleDone(a.task.id, taskDone)}
                          className={cn(
                            "shrink-0 transition-colors",
                            taskDone
                              ? "text-primary"
                              : "text-muted-foreground hover:text-primary",
                          )}
                          title={taskDone ? "Mark not done" : "Mark done"}
                          aria-label={taskDone ? "Mark not done" : "Mark done"}
                        >
                          {taskDone ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                        </button>
                        <span
                          className={cn(
                            "flex-1 text-xs truncate",
                            taskDone && "line-through text-muted-foreground",
                          )}
                        >
                          {a.task.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggle(a.task.id)}
                          className="shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Detach task"
                          aria-label="Detach task"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Task search */}
            <div className="relative px-1 mt-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                autoFocus
                placeholder="Attach a task…"
                className="h-7 pl-7 text-xs"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                // Base-ui Menu would otherwise treat typing as keyboard nav.
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>

            <div className="max-h-56 overflow-y-auto mt-1 px-1">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground italic px-1 py-1.5">
                  {tasks ? "No matches." : "Loading…"}
                </p>
              ) : (
                filtered.slice(0, 50).map((t) => {
                  const on = attachedIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggle(t.id)}
                      className={cn(
                        "w-full text-left px-1.5 py-1 text-xs rounded-md flex items-center gap-2 hover:bg-accent/60",
                        on && "bg-accent/40",
                      )}
                    >
                      <span
                        className={cn(
                          "size-3.5 rounded border flex items-center justify-center shrink-0",
                          on ? "bg-primary border-primary text-primary-foreground" : "border-input",
                        )}
                      >
                        {on ? <Check className="size-2.5" /> : null}
                      </span>
                      <span className="truncate flex-1">{t.name}</span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="h-px bg-border my-1.5 -mx-2" />

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEdit(event.id);
              }}
              className="w-full text-left px-2 py-1 text-xs rounded-md flex items-center gap-2 hover:bg-accent/60"
            >
              <PencilLine className="size-3.5" /> Edit details…
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="w-full text-left px-2 py-1 text-xs rounded-md flex items-center gap-2 hover:bg-destructive/10 text-destructive"
            >
              <Trash2 className="size-3.5" /> Delete event
            </button>

            {event.attributions.length > 0 ? null : (
              <p className="text-[10px] text-muted-foreground italic px-2 pt-1 flex items-center gap-1">
                <Plus className="size-2.5" /> Click a task above to attach it.
              </p>
            )}
          </CtxPrimitive.Popup>
        </CtxPrimitive.Positioner>
      </CtxPrimitive.Portal>
    </CtxPrimitive.Root>
  );
}
