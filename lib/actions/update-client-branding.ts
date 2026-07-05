"use server";

import { revalidatePath } from "next/cache";

import { requireClientContext } from "@/lib/auth/get-client-context";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  buildBrandingUpdate,
  parseBrandingForm,
} from "@/lib/admin/branding-schema";

/**
 * lib/actions/update-client-branding.ts
 *
 * Server action behind the org/brand settings form (OP909 Phase 2).
 * Client-scope enforcement contract (docs/ADMIN_DASHBOARD_ARCHITECTURE.md
 * §3): requireClientContext() FIRST, then the write targets ONLY the
 * caller's own client_id — the id never comes from the form payload.
 * Writes use the service-role client because client-member RLS is
 * SELECT-only by design.
 */

export interface UpdateBrandingState {
  status: "idle" | "saved" | "error";
  errors: Record<string, string>;
}

export async function updateClientBranding(
  _prev: UpdateBrandingState,
  formData: FormData,
): Promise<UpdateBrandingState> {
  const membership = await requireClientContext();

  const parsed = parseBrandingForm({
    logo_style: formData.get("logo_style"),
    box_logo_text: formData.get("box_logo_text"),
    brand_color: formData.get("brand_color"),
    privacy_policy_url: formData.get("privacy_policy_url"),
    brand_instagram_url_default: formData.get("brand_instagram_url_default"),
    brand_tiktok_url_default: formData.get("brand_tiktok_url_default"),
    show_off_pixel_attribution: formData.get("show_off_pixel_attribution"),
  });
  if (!parsed.ok) {
    return { status: "error", errors: parsed.errors };
  }

  const db = createServiceRoleClient();

  // Read the current theme so brand_color merges into it rather than
  // flattening operator-authored keys.
  const { data: existing, error: readError } = await db
    .from("client_landing_pages")
    .select("id, theme")
    .eq("client_id", membership.clientId)
    .maybeSingle();
  if (readError) {
    return {
      status: "error",
      errors: { _form: `Could not load settings: ${readError.message}` },
    };
  }

  const payload = buildBrandingUpdate(
    (existing?.theme ?? null) as Record<string, unknown> | null,
    parsed.value,
  );

  const { error: writeError } = existing
    ? await db
        .from("client_landing_pages")
        .update(payload)
        .eq("client_id", membership.clientId)
    : await db
        .from("client_landing_pages")
        .insert({ ...payload, client_id: membership.clientId });
  if (writeError) {
    return {
      status: "error",
      errors: { _form: `Save failed: ${writeError.message}` },
    };
  }

  revalidatePath(`/admin/${membership.clientSlug}/settings`);
  return { status: "saved", errors: {} };
}
