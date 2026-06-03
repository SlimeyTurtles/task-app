import { WikiClient } from "../wiki-client";

export default async function WikiPageRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <WikiClient slug={slug} />;
}
