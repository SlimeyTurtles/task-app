import { PageShell } from "@/components/app/page-shell";
import { TimeBlocksClient } from "./time-blocks-client";

export default function TimeBlocksSettingsPage() {
  return (
    <PageShell
      title="Time blocks"
      description="Stable background time the scheduler treats as constraint: sleep, work hours, commute."
    >
      <TimeBlocksClient />
    </PageShell>
  );
}
