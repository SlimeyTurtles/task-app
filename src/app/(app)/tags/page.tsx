import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function TagsPage() {
  return (
    <PageShell title="Tags" description="Manage the tag tree. Drag-to-reparent, share, recolor.">
      <PhaseStub phase={2} />
    </PageShell>
  );
}
