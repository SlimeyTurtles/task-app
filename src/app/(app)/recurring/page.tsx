import { PageShell } from "@/components/app/page-shell";
import { RecurringClient } from "./recurring-client";

export default function RecurringPage() {
  return (
    <PageShell title="Recurring" description="Templates that materialize future tasks on a schedule.">
      <RecurringClient />
    </PageShell>
  );
}
