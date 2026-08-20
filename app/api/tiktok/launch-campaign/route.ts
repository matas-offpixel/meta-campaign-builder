/**
 * POST /api/tiktok/launch-campaign
 *
 * { draftId } → campaign → ad groups → ads on TikTok.
 * Enhancements stay off (`is_aco: false`, `creative_authorized: false`).
 * Campaign, ad groups, and ads are created paused (`operation_status:
 * DISABLE`) so enabling the campaign is a second, explicit gate.
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

export async function POST(req: NextRequest): Promise<Response> {
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const result = await handleTikTokLaunch({
          userId: user?.id ?? null,
          draftId,
          session: supabase,
          admin: createServiceRoleClient(),
          onProgress: (progress) => {
            emit({ type: "progress", ...progress });
          },
        });
        emit({ type: "result", status: result.status, body: result.body });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({
          type: "result",
          status: 500,
          body: { ok: false, error: message },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
