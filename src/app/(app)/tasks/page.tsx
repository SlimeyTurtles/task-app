import { PageShell } from "@/components/app/page-shell";
import { AllTasksClient } from "./all-tasks-client";

export default function AllTasksPage() {
  return (
    <PageShell
      title="All Tasks"
      description="Filter across the full backlog by status, area, project, tag, or due date."
    >
      <AllTasksClient />
    </PageShell>
  );
}
