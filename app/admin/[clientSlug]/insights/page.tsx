import { ComingSoon } from "@/components/admin/coming-soon";
import { requireClientContext } from "@/lib/auth/get-client-context";

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  await requireClientContext(clientSlug);
  return (
    <ComingSoon
      title="Insights"
      description="Signup momentum, country breakdowns, and opt-in rates are coming here."
    />
  );
}
