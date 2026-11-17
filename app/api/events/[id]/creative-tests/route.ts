/**
 * GET /api/events/{id}/creative-tests — the Test plan panel (CT9, TT6, TF3)
 * and the canvas chip (CT9) for the operator's own event. Read-only: no Meta
 * call, no write. Operator-only through the /api gate (#1276), then the
 * event's owner.
 */

import { NextResponse, type NextRequest } from "next/server";

import { loadTestInputs } from "@/lib/creative-tests/panel-read";
import { buildPanel } from "@/lib/creative-tests/panel-view";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const db = createServiceRoleClient();
  const event = await db.from("events").select("id, event_code").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (event.error) return NextResponse.json({ ok: false, error: event.error.message }, { status: 500 });
  if (!event.data) return NextResponse.json({ ok: false, error: "Event not found on this account." }, { status: 404 });
  try {
    const inputs = await loadTestInputs(db, [id]);
    const view = buildPanel({ eventCode: (event.data as { event_code: string | null }).event_code, ...inputs, now: new Date().toISOString() });
    return NextResponse.json({ ok: true, view });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Test plan read failed" }, { status: 500 });
  }
}
