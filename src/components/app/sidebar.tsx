"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV } from "./nav";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-60 md:flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="px-4 py-5 border-b">
        <Link href="/calendar" className="flex items-baseline gap-1.5">
          <span className="font-heading text-2xl font-semibold tracking-tight">Almanac</span>
          <span className="size-1.5 rounded-full bg-primary -translate-y-0.5" />
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-6">
        {NAV.map((section) => (
          <div key={section.label}>
            <div className="px-2 mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/" && pathname.startsWith(item.href + "/"));
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
