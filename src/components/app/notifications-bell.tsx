"use client";

import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";

const POLL_MS = 60_000;

export function NotificationsBell() {
  const utils = trpc.useUtils();
  const { data } = trpc.notifications.unread.useQuery(undefined, {
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => utils.notifications.unread.invalidate(),
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => utils.notifications.unread.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const count = data?.count ?? 0;
  const items = data?.items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
            <Bell className="size-5" />
            {count > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium tabular-nums px-1 flex items-center justify-center">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80">
        <div className="px-2 py-1.5 flex items-center justify-between">
          <span className="text-sm font-medium">Notifications</span>
          {count > 0 ? (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <CheckCheck className="size-3" /> Mark all read
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">
            Nothing yet. Due dates will land here.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto py-1">
            {items.map((n) => (
              <Link
                key={n.id}
                href={n.taskId ? `/tasks?id=${n.taskId}` : "/tasks"}
                onClick={() => markRead.mutate({ id: n.id })}
                className="block px-3 py-2 hover:bg-accent/40 transition-colors"
              >
                <p className="text-sm leading-tight">{n.message}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                  {new Date(n.dueAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </Link>
            ))}
          </div>
        )}
        <DropdownMenuSeparator />
        <Link
          href="/settings/notifications"
          className="block px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Notification settings →
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
