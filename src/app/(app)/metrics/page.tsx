import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function MetricsPage() {
  return (
    <PageShell title="Metrics" description="Time by tag / area / project, capacity trends, estimate accuracy.">
      <PhaseStub phase={5} />
    </PageShell>
  );
}
