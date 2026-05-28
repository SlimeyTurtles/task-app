import { PageShell } from "@/components/app/page-shell";
import { CalendarClient } from "./calendar-client";

export default function CalendarPage() {
  return (
    <PageShell fill>
      <CalendarClient />
    </PageShell>
  );
}
