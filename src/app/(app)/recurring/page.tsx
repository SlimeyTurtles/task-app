import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function RecurringPage() {
  return (
    <PageShell title="Recurring" description="Manage recurrence templates with an RRULE editor.">
      <PhaseStub phase={8} />
    </PageShell>
  );
}
