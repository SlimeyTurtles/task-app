import { PageShell } from "@/components/app/page-shell";
import { MetricsClient } from "./metrics-client";

export default function MetricsPage() {
  return (
    <PageShell
      title="Metrics"
      description="Time by area / project / tag, capacity trend, and learned estimate-accuracy multipliers."
    >
      <MetricsClient />
    </PageShell>
  );
}
