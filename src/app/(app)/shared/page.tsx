import { PageShell } from "@/components/app/page-shell";
import { SharedClient } from "./shared-client";

export default function SharedPage() {
  return (
    <PageShell
      title="Shared with me"
      description="Tasks and tags other users have shared with you, kept separate from your own data."
    >
      <SharedClient />
    </PageShell>
  );
}
