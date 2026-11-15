import { NextResponse } from "next/server";

import { EVENT_NOT_ON_ACCOUNT, SIGN_IN_AGAIN } from "@/lib/drive/panel";
import type { PickerEvent } from "@/lib/drive/picker";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/** The signed-in operator's own event, as the From Drive picker reads it (same rule as /api/events/[id]/drive). */
export async function ownedPickerEvent(eventId: string): Promise<
  { error: NextResponse } | { error?: undefined; db: ReturnType<typeof createServiceRoleClient>; event: PickerEvent; userId: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: SIGN_IN_AGAIN }, { status: 401 }) };
  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("events")
    .select("id, name, event_code, status, event_date, drive_folder_id")
    .eq("id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return { error: NextResponse.json({ ok: false, error: error.message }, { status: 500 }) };
  if (!data) return { error: NextResponse.json({ ok: false, error: EVENT_NOT_ON_ACCOUNT }, { status: 404 }) };
  return { db, event: data as PickerEvent, userId: user.id };
}
