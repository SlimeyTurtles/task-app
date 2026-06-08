import { JournalClient } from "../journal-client";

export default async function JournalSessionRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <JournalClient sessionId={id} />;
}
