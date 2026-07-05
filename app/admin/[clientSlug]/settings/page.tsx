import { ComingSoon } from "@/components/admin/coming-soon";
import { requireClientContext } from "@/lib/auth/get-client-context";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  await requireClientContext(clientSlug);
  return (
    <ComingSoon
      title="Settings"
      description="Brand identity, logo style, colors, and socials — your landing page defaults will be editable here."
    />
  );
}
