import { NextResponse, type NextRequest } from "next/server";

import { applyGates } from "@/lib/onsale-refresh/apply-gates";

import { ownedRefreshEvent } from "../_owned";

/**
 * POST /api/events/[id]/onsale-refresh/arm { mode: "shadow" | "live" }
 *
 * The per-event arm (R4), as the budget tick's. Live acts only while the
 * deployment gate ONSALE_REFRESH_APPLY_ENABLED is "1"; with it off the arm
 * is stored and the panel stays in Shadow. Arming never applies anything:
 * Apply accepted (n) is a separate click. Service-role write after the
 * owner check (migration 236 gives the authenticated role read only).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const who = await ownedRefreshEvent(id);
  if (who.error) return who.error;
  let body: { mode?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Unreadable request." }, { status: 400 });
  }
  if (body.mode !== "shadow" && body.mode !== "live") return NextResponse.json({ ok: false, error: "mode must be shadow or live" }, { status: 400 });
  const now = new Date().toISOString();
  const { error } = await who.db
    .from("onsale_refresh_arms")
    .upsert({ event_id: who.event.id, user_id: who.userId, mode: body.mode, armed_by: who.userId, armed_at: now, updated_at: now }, { onConflict: "event_id" });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const gates = applyGates(process.env, body.mode);
  return NextResponse.json({ ok: true, apply: { mode: gates.mode, arm: gates.arm, globalEnabled: gates.globalEnabled, pauseWritesEnabled: gates.pauseWritesEnabled, adsetStatusWritesEnabled: gates.adsetStatusWritesEnabled, budgetWritesEnabled: gates.budgetWritesEnabled, audienceWritesEnabled: gates.audienceWritesEnabled, budgetSet: who.budgetSet } });
}
