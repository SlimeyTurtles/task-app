import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function InboxPage() {
  return (
    <PageShell title="Inbox" description="Quick-capture landing zone and unscheduled tasks.">
      <PhaseStub phase={2} />
    </PageShell>
  );
}
