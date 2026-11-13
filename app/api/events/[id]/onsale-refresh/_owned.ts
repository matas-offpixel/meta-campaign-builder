import { NextResponse } from "next/server";

import { applyGates, type ApplyGates } from "@/lib/onsale-refresh/apply-gates";
import { loadArm } from "@/lib/onsale-refresh/read";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export type OwnedRefreshEvent = {
  error?: undefined;
  /** Service role: every refresh write goes through it, after this owner check. */
  db: ReturnType<typeof createServiceRoleClient>;
  session: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  event: { id: string; name: string; event_code: string | null; status: string | null; event_date: string | null; drive_folder_id: string | null; budget_marketing: number | string | null };
  gates: ApplyGates;
  budgetSet: boolean;
};

/** The signed-in operator's own event, with the refresh's gates (R4): the deployment gate and the event's arm. */
export async function ownedRefreshEvent(eventId: string): Promise<{ error: NextResponse } | OwnedRefreshEvent> {
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("events")
    .select("id, name, event_code, status, event_date, drive_folder_id, budget_marketing")
    .eq("id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return { error: NextResponse.json({ ok: false, error: error.message }, { status: 500 }) };
  if (!data) return { error: NextResponse.json({ ok: false, error: "Event not found on this account." }, { status: 404 }) };
  const event = data as OwnedRefreshEvent["event"];
  const gates = applyGates(process.env, await loadArm(db, event.id));
  const budgetSet = event.budget_marketing != null && Number.isFinite(Number(event.budget_marketing));
  return { db, session, userId: user.id, event, gates, budgetSet };
}
