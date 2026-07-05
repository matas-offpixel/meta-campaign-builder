import {
  BrandingSettingsForm,
  type BrandingFormInitial,
} from "@/components/admin/branding-settings-form";
import { requireClientContext } from "@/lib/auth/get-client-context";
import { createClient } from "@/lib/supabase/server";

/**
 * app/admin/[clientSlug]/settings/page.tsx — org/brand settings editor
 * (OP909 Phase 2). Reads the client_landing_pages row via the SESSION
 * client (client-member SELECT RLS); writes go through the
 * updateClientBranding server action (service-role, scope-checked).
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);

  // client_landing_pages is missing from the generated database.types.ts
  // (dump lags migrations 132+), so the row is typed explicitly here.
  interface SettingsRow {
    logo_style: string | null;
    box_logo_text: string | null;
    theme: Record<string, unknown> | null;
    privacy_policy_url: string | null;
    brand_instagram_url_default: string | null;
    brand_tiktok_url_default: string | null;
    show_off_pixel_attribution: boolean | null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_landing_pages")
    .select(
      "logo_style, box_logo_text, theme, privacy_policy_url, " +
        "brand_instagram_url_default, brand_tiktok_url_default, " +
        "show_off_pixel_attribution",
    )
    .eq("client_id", membership.clientId)
    .maybeSingle();
  if (error) {
    throw new Error(`[admin-settings] settings load failed: ${error.message}`);
  }
  const row = data as SettingsRow | null;

  const theme = (row?.theme ?? {}) as Record<string, unknown>;
  const brandColor =
    typeof theme.primary_color === "string" ? theme.primary_color : "";

  const initial: BrandingFormInitial = {
    clientName: membership.clientName,
    clientSlug: membership.clientSlug,
    logoStyle: row?.logo_style === "wordmark" ? "wordmark" : "box_logo",
    boxLogoText: row?.box_logo_text ?? "",
    brandColor,
    privacyPolicyUrl: row?.privacy_policy_url ?? "",
    brandInstagramUrl: row?.brand_instagram_url_default ?? "",
    brandTiktokUrl: row?.brand_tiktok_url_default ?? "",
    showOffPixelAttribution: row?.show_off_pixel_attribution ?? true,
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="font-heading text-2xl tracking-wide">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Brand identity and defaults for your landing pages.
      </p>
      <div className="mt-6">
        <BrandingSettingsForm initial={initial} />
      </div>
    </div>
  );
}
