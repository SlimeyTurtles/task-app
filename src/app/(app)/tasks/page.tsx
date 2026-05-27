import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function AllTasksPage() {
  return (
    <PageShell title="All Tasks" description="Flat filterable list with saved filters and bulk edit.">
      <PhaseStub phase={2} />
    </PageShell>
  );
}
