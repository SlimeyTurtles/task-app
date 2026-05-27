import { PageShell } from "@/components/app/page-shell";
import { ProjectDetailClient } from "./project-detail-client";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageShell>
      <ProjectDetailClient id={id} />
    </PageShell>
  );
}
