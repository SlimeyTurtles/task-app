import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function TodayPage() {
  return (
    <PageShell title="Today" description="Your single-day calendar grid and quick capture.">
      <PhaseStub phase={3} />
    </PageShell>
  );
}
