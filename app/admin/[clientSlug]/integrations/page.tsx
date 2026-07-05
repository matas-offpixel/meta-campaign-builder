import { ComingSoon } from "@/components/admin/coming-soon";
import { requireClientContext } from "@/lib/auth/get-client-context";

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  await requireClientContext(clientSlug);
  return (
    <ComingSoon
      title="Integrations"
      description="Meta Pixel, WhatsApp (Bird), and Mailchimp connections will be configured here."
    />
  );
}
