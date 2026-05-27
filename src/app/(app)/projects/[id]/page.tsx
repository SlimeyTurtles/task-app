import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageShell title="Project" description={`Detail view for project ${id}.`}>
      <PhaseStub phase={2} />
    </PageShell>
  );
}
