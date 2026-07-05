import { ComingSoon } from "@/components/admin/coming-soon";
import { requireClientContext } from "@/lib/auth/get-client-context";

export default async function FansPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  await requireClientContext(clientSlug);
  return (
    <ComingSoon
      title="Fans"
      description="Your fan signups will appear here — searchable, filterable, and exportable to CSV."
    />
  );
}
