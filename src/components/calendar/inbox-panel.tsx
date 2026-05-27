"use client";

import { TaskStatus } from "@prisma/client";
import { GripVertical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";

/**
 * Draggable inbox panel. Each task is HTML5-draggable with mime
 * `application/x-task-id` carrying the task id.
 */
export function InboxPanel() {
  const { data: tasks } = trpc.tasks.list.useQuery({
    status: [TaskStatus.INBOX, TaskStatus.SCHEDULED, TaskStatus.IN_PROGRESS],
    limit: 50,
  });

  return (
    <div className="w-64 shrink-0 hidden lg:flex flex-col">
      <div className="px-1 mb-2 text-xs uppercase tracking-wider text-muted-foreground">
        Inbox · drag onto the grid
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {tasks?.length ? (
          tasks.map((t) => (
            <Card
              key={t.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-task-id", t.id);
                e.dataTransfer.setData("text/plain", t.name);
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="px-2 py-1.5 flex items-start gap-1.5 cursor-grab active:cursor-grabbing hover:bg-accent/30"
              data-task-id={t.id}
            >
              <GripVertical className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{t.name}</div>
                <div className="flex flex-wrap gap-1 mt-0.5 text-xs text-muted-foreground">
                  {t.project ? <Badge variant="outline">{t.project.name}</Badge> : null}
                  {t.estimatedMinutes ? <span>{t.estimatedMinutes}m</span> : null}
                </div>
              </div>
            </Card>
          ))
        ) : (
          <p className="text-sm text-muted-foreground px-1">No tasks ready to schedule.</p>
        )}
      </div>
    </div>
  );
}
