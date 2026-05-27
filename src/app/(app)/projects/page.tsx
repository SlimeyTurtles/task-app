import { PageShell } from "@/components/app/page-shell";
import { ProjectsClient } from "./projects-client";

export default function ProjectsPage() {
  return (
    <PageShell
      title="Projects"
      description="Bounded efforts within an area, each with a definition of done."
    >
      <ProjectsClient />
    </PageShell>
  );
}
