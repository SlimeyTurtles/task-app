"use client";

import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { Laptop, LogOut, Mail, Moon, Sun } from "lucide-react";
import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Three-way theme picker: light / dark / system. Inline (not a submenu)
// so it's one click. Uses next-themes — provider is mounted in Providers.
function ThemeRow() {
  const { theme, setTheme } = useTheme();
  const opts: Array<{ value: "light" | "dark" | "system"; icon: typeof Sun; label: string }> = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Laptop, label: "System" },
  ];
  return (
    <div className="px-2 py-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
        Theme
      </div>
      <div className="inline-flex w-full rounded-md border p-0.5">
        {opts.map(({ value, icon: Icon, label }) => {
          const active = theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1 rounded-sm px-1.5 py-1 text-xs transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={label}
              aria-pressed={active}
              title={label}
            >
              <Icon className="size-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function UserMenu() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? session?.user?.email ?? "User";
  const initials = (name.match(/\b\w/g) ?? ["U"]).slice(0, 2).join("").toUpperCase();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="rounded-full">
            <Avatar className="size-8">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <div className="text-sm font-medium truncate">{name}</div>
          {session?.user?.email ? (
            <div className="text-xs text-muted-foreground truncate">{session.user.email}</div>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        <ThemeRow />
        <DropdownMenuSeparator />
        {isAdmin ? (
          <DropdownMenuItem render={<Link href="/invites" />}>
            <Mail className="mr-2 size-4" />
            Invites
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
          <LogOut className="mr-2 size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
