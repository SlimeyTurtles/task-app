import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function WeekPage() {
  return (
    <PageShell title="Week" description="7-day grid with per-day stress / exhaustion totals.">
      <PhaseStub phase={3} />
    </PageShell>
  );
}
