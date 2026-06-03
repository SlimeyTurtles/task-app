import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { InvitesClient } from "./invites-client";

export default async function InvitesPage() {
  // Defence in depth — protectedProcedure on the tRPC side also rejects, but
  // gating the route here keeps non-admins from even seeing the page chrome.
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (me?.role !== "ADMIN") redirect("/calendar");

  return <InvitesClient />;
}
