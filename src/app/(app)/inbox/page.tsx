import { PageShell } from "@/components/app/page-shell";
import { InboxClient } from "./inbox-client";

export default function InboxPage() {
  return (
    <PageShell
      title="Inbox"
      description="Capture anything in 3 seconds. Schedule and detail it later."
    >
      <InboxClient />
    </PageShell>
  );
}
