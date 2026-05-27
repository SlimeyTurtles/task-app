import { auth } from "@/lib/auth";
import { PageShell } from "@/components/app/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ProfileSettingsPage() {
  const session = await auth();
  const user = session?.user;

  return (
    <PageShell title="Profile" description="Account basics.">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Name</span>
            <span>{user?.name ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email</span>
            <span>{user?.email ?? "—"}</span>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
