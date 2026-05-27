import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function ProjectsPage() {
  return (
    <PageShell title="Projects" description="Bounded efforts with definition of done and due dates.">
      <PhaseStub phase={2} />
    </PageShell>
  );
}
