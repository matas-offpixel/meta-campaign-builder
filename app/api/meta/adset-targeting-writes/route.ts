import {
  ADSET_TARGETING_WRITES_DISABLED_MESSAGE,
  adsetTargetingWritesEnabled,
} from "@/lib/meta/adset-targeting-write";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const enabled = adsetTargetingWritesEnabled();
  return Response.json({
    enabled,
    message: enabled ? null : ADSET_TARGETING_WRITES_DISABLED_MESSAGE,
  });
}
