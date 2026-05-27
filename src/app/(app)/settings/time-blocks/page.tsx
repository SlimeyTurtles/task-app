import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function TimeBlocksSettingsPage() {
  return (
    <PageShell title="Time blocks" description="Sleep window, work hours, recurring meals, commute.">
      <PhaseStub phase={4} />
    </PageShell>
  );
}
