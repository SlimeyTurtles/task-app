import { PageShell } from "@/components/app/page-shell";
import { NotificationsSettingsClient } from "./notifications-client";

export default function NotificationsSettingsPage() {
  return (
    <PageShell title="Notifications" description="Lead time and quiet hours for due-date alerts.">
      <NotificationsSettingsClient />
    </PageShell>
  );
}
