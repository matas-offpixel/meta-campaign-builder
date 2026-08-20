/**
 * POST /api/tiktok/launch-campaign
 *
 * { draftId } → campaign → ad groups → ads on TikTok.
 * Enhancements stay off (`is_aco: false`, `creative_authorized: false`).
 * Campaigns are created paused (`operation_status: DISABLE`) so the first
 * live write can be inspected before spend starts.
 *
 * GET returns whether OFFPIXEL_TIKTOK_WRITES_ENABLED is on, so Review &
 * Launch can disable the button with a reason before the operator clicks.
 */

import { NextRequest, NextResponse } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  isTikTokWritesEnabled,
  TIKTOK_WRITES_DISABLED_REASON,
} from "@/lib/tiktok/write/feature-flag";
import { handleTikTokLaunch } from "@/lib/tiktok/write/launch";

export const maxDuration = 800;

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const writesEnabled = isTikTokWritesEnabled();
  return NextResponse.json({
    ok: true,
    writesEnabled,
    reason: writesEnabled ? null : TIKTOK_WRITES_DISABLED_REASON,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let draftId: unknown;
  try {
    const body = (await req.json()) as { draftId?: unknown };
    draftId = body?.draftId;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body: bad JSON" },
      { status: 400 },
    );
  }

  const result = await handleTikTokLaunch({
    userId: user?.id ?? null,
    draftId,
    session: supabase,
    admin: createServiceRoleClient(),
  });
  return NextResponse.json(result.body, { status: result.status });
}
