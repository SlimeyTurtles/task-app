import { PageShell } from "@/components/app/page-shell";
import { TagsClient } from "./tags-client";

export default function TagsPage() {
  return (
    <PageShell
      title="Tags"
      description="Orthogonal context labels — they nest, so querying a parent matches all descendants."
    >
      <TagsClient />
    </PageShell>
  );
}
