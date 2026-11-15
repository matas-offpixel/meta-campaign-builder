import { metaAudienceWritesEnabled } from "@/lib/meta/audience-write";
import { META_AUDIENCE_WRITES_DISABLED_MESSAGE } from "@/lib/audiences/creator-audience";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const enabled = metaAudienceWritesEnabled();
  return Response.json({
    enabled,
    message: enabled ? null : META_AUDIENCE_WRITES_DISABLED_MESSAGE,
  });
}
