import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function DependenciesPage() {
  return (
    <PageShell title="Dependencies" description="Visual dependency graph for a project or filtered set.">
      <PhaseStub phase={9} />
    </PageShell>
  );
}
