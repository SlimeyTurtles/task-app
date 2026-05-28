import { PageShell } from "@/components/app/page-shell";
import { SharingClient } from "./sharing-client";

export default function SharingSettingsPage() {
  return (
    <PageShell title="Sharing" description="Manage what you've shared and revoke access at any time.">
      <SharingClient />
    </PageShell>
  );
}
