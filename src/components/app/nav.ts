import {
  Calendar,
  CalendarDays,
  Inbox,
  Folders,
  KanbanSquare,
  ListChecks,
  Tag,
  Repeat,
  Sparkles,
  BarChart3,
  Network,
  Share2,
  User,
  Battery,
  Clock,
  Bell,
  Users,
  KeyRound,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Phase number from the build plan in which this page becomes functional. */
  phase?: number;
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export const NAV: NavSection[] = [
  {
    label: "Plan",
    items: [
      { href: "/today", label: "Today", icon: Calendar, phase: 3 },
      { href: "/week", label: "Week", icon: CalendarDays, phase: 3 },
      { href: "/inbox", label: "Inbox", icon: Inbox, phase: 2 },
      { href: "/tasks", label: "All Tasks", icon: ListChecks, phase: 2 },
    ],
  },
  {
    label: "Organize",
    items: [
      { href: "/areas", label: "Areas", icon: Folders, phase: 2 },
      { href: "/projects", label: "Projects", icon: KanbanSquare, phase: 2 },
      { href: "/tags", label: "Tags", icon: Tag, phase: 2 },
      { href: "/recurring", label: "Recurring", icon: Repeat, phase: 8 },
      { href: "/someday", label: "Someday", icon: Sparkles, phase: 9 },
      { href: "/dependencies", label: "Dependencies", icon: Network, phase: 9 },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/metrics", label: "Metrics", icon: BarChart3, phase: 5 },
      { href: "/shared", label: "Shared with me", icon: Share2, phase: 6 },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings/profile", label: "Profile", icon: User, phase: 1 },
      { href: "/settings/capacity", label: "Capacity", icon: Battery, phase: 4 },
      { href: "/settings/time-blocks", label: "Time blocks", icon: Clock, phase: 4 },
      { href: "/settings/notifications", label: "Notifications", icon: Bell, phase: 8 },
      { href: "/settings/sharing", label: "Sharing", icon: Users, phase: 6 },
      { href: "/settings/api", label: "API & Webhooks", icon: KeyRound, phase: 7 },
    ],
  },
];
