import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/app/sidebar";
import { UserMenu } from "@/components/app/user-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  // Proxy enforces this too, but server-side guard hardens against misconfiguration.
  if (!session?.user) redirect("/login");

  return (
    <div className="flex flex-1 min-h-svh">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <header className="h-14 border-b flex items-center justify-end px-4 md:px-6 gap-2">
          <UserMenu />
        </header>
        <main className="flex-1 flex flex-col items-stretch">{children}</main>
      </div>
    </div>
  );
}
