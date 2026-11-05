/**
 * POST /api/admin/remotion/render-caption
 *
 * Burns one caption onto one clip (one creative_lab_renders row) and
 * registers the mp4. The render runs on Remotion Lambda in eu-west-2.
 * Body: { "renderId": "<uuid>" }.
 *
 * A measurement body, { "timing": { "storagePath", "lines", "aspect" } },
 * renders on Lambda, deletes the S3 object, and writes no creative_assets
 * row. That is how the 1080p feasibility timing is taken.
 *
 * Auth: cookie-bound operator session, same as render-reel.
 * Flag: FEATURE_REMOTION=1. maxDuration 300. Default function memory.
 * REMOTION_LAMBDA_SERVE_URL must be set (scripts/remotion-lambda-deploy.mts
 * prints it). This route does not use Chrome or the compositor, and it
 * does not depend on the Remotion files traced in next.config.ts.
 *
 * render-reel still renders in-process with the compositor, which the
 * Vercel function image cannot start. It is left on that path.
 */

import { NextResponse } from "next/server";

import { isRemotionEnabled } from "@/lib/creatives/types";
import { renderCaptionOnClip, renderTimingSample } from "@/lib/creative-lab/render";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  renderId?: string;
  timing?: { storagePath?: string; bucket?: string; lines?: string[]; aspect?: string; cropFocusY?: number };
};

export async function POST(request: Request): Promise<NextResponse> {
  if (!isRemotionEnabled()) {
    return NextResponse.json({ error: "FEATURE_REMOTION is off — enable it in environment variables to run renders." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  try {
    if (body.timing) {
      const aspect = body.timing.aspect;
      if (aspect !== "9:16") return NextResponse.json({ error: "timing.aspect must be 9:16" }, { status: 400 });
      if (!body.timing.storagePath || !Array.isArray(body.timing.lines)) {
        return NextResponse.json({ error: "timing needs storagePath and lines" }, { status: 400 });
      }
      const result = await renderTimingSample({
        bucket: body.timing.bucket ?? "campaign-assets",
        storagePath: body.timing.storagePath,
        lines: body.timing.lines,
        aspect: "9:16",
        cropFocusY: body.timing.cropFocusY,
      });
      console.error(
        `[render-caption] TIMING ${result.width}x${result.height} ${result.durationSeconds.toFixed(1)}s renderMs=${result.renderMs} cost=${result.estimatedCostDisplay ?? "n/a"}`,
      );
      return NextResponse.json({ timing: true, ...result });
    }

    if (!body.renderId) return NextResponse.json({ error: "renderId is required" }, { status: 400 });
    const result = await renderCaptionOnClip(supabase, { renderId: body.renderId, userId: user.id });
    console.error(
      `[render-caption] DONE renderId=${result.renderId} aspect=${result.aspect} ` +
        `${result.width}x${result.height} renderMs=${result.renderMs} asset=${result.creativeAssetId} cost=${result.estimatedCostDisplay ?? "n/a"}`,
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[render-caption] ERROR:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
