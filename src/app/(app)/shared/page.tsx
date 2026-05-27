import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function SharedPage() {
  return (
    <PageShell title="Shared with me" description="Tasks and tags other users have shared with you.">
      <PhaseStub phase={6} />
    </PageShell>
  );
}
