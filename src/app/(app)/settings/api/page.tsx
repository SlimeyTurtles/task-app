import { PageShell, PhaseStub } from "@/components/app/page-shell";

export default function ApiSettingsPage() {
  return (
    <PageShell title="API & Webhooks" description="API keys, webhook subscriptions, OpenAPI spec.">
      <PhaseStub phase={7} />
    </PageShell>
  );
}
