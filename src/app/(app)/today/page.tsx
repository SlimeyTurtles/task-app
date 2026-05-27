import { PageShell } from "@/components/app/page-shell";
import { TodayClient } from "./today-client";

export default function TodayPage() {
  return (
    <PageShell>
      <TodayClient />
    </PageShell>
  );
}
