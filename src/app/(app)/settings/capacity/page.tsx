import { PageShell } from "@/components/app/page-shell";
import { CapacityClient } from "./capacity-client";

export default function CapacitySettingsPage() {
  return (
    <PageShell
      title="Capacity"
      description="Daily stress / exhaustion / focused-hours budgets and recovery rules."
    >
      <CapacityClient />
    </PageShell>
  );
}
