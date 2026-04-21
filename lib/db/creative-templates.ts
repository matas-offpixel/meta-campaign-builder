import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CreativeRender,
  CreativeTemplate,
} from "@/lib/creatives/types";

/**
 * lib/db/creative-templates.ts
 *
 * Server-side CRUD for the two tables in migration 031:
 *   - creative_templates
 *   - creative_renders
 *
 * Same regen-pending casting pattern as `lib/db/ticketing.ts` /
 * `lib/db/d2c.ts`. After Matas applies migration 031 and regens
 * `lib/db/database.types.ts`, drop the cast and use typed table names
 * directly.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

function asAny(supabase: AnySupabaseClient): AnySupabaseClient {
  return supabase;
}

export async function listCreativeTemplatesForUser(
  supabase: AnySupabaseClient,
): Promise<CreativeTemplate[]> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("creative_templates")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[creatives listTemplates]", error.message);
    return [];
  }
  return (data ?? []) as unknown as CreativeTemplate[];
}

export async function listCreativeRendersForEvent(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<CreativeRender[]> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("creative_renders")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[creatives listRenders]", error.message);
    return [];
  }
  return (data ?? []) as unknown as CreativeRender[];
}
