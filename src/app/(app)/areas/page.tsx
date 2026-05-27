import { PageShell } from "@/components/app/page-shell";
import { AreasClient } from "./areas-client";

export default function AreasPage() {
  return (
    <PageShell
      title="Areas"
      description="Ongoing responsibilities: pets, work, school, research."
    >
      <AreasClient />
    </PageShell>
  );
}
