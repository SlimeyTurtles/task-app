import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function SomedayPage() {
  return (
    <PageShell title="Someday" description="Bucketlist and long-horizon ideas without a due date.">
      <PhaseStub phase={9} />
    </PageShell>
  );
}
