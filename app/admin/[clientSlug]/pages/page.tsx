import { ComingSoon } from "@/components/admin/coming-soon";
import { requireClientContext } from "@/lib/auth/get-client-context";

export default async function PagesPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  await requireClientContext(clientSlug);
  return (
    <ComingSoon
      title="Pages"
      description="Landing page management is coming here — create, edit, and publish pages for your events."
    />
  );
}
