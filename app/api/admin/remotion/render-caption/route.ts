/**
 * POST /api/admin/remotion/render-caption
 *
 * Burns one caption onto one clip (one creative_lab_renders row) and
 * registers the mp4. Body: { "renderId": "<uuid>" }.
 *
 * A measurement body, { "timing": { "storagePath", "lines", "aspect" } },
 * renders and drops the file. It writes no creative_assets row. That is
 * how the 1080p feasibility timing is taken.
 *
 * Auth: cookie-bound operator session, same as render-reel.
 * Flag: FEATURE_REMOTION=1. Memory 3 GB, 600s.
 */

import fs from "node:fs/promises";
import path from "node:path";

import chromium from "@sparticuz/chromium";
import { NextResponse } from "next/server";

import { isRemotionEnabled } from "@/lib/creatives/types";
import { renderCaptionOnClip, renderTimingSample } from "@/lib/creative-lab/render";
import type { CaptionAspect } from "@/src/remotion/caption-style/profile";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const config = { memory: 3008 };

function bundlePath(): string {
  return path.join(process.cwd(), ".remotion/bundle");
}

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
    await fs.access(bundlePath());
  } catch {
    return NextResponse.json({ error: "Remotion bundle not found. Run `npm run bundle-remotion` before deploying." }, { status: 500 });
  }

  const originalCwd = process.cwd();
  const tmpCwd = "/tmp/remotion-cwd";
  await fs.mkdir(tmpCwd, { recursive: true });
  process.chdir(tmpCwd);

  try {
    const browserExecutable = await chromium.executablePath();
    const serveUrl = bundlePath();

    if (body.timing) {
      const aspect = body.timing.aspect;
      if (aspect !== "9:16" && aspect !== "4:5") return NextResponse.json({ error: "timing.aspect must be 9:16 or 4:5" }, { status: 400 });
      if (!body.timing.storagePath || !Array.isArray(body.timing.lines)) {
        return NextResponse.json({ error: "timing needs storagePath and lines" }, { status: 400 });
      }
      const result = await renderTimingSample({
        bucket: body.timing.bucket ?? "campaign-assets",
        storagePath: body.timing.storagePath,
        lines: body.timing.lines,
        aspect: aspect as CaptionAspect,
        cropFocusY: body.timing.cropFocusY,
        serveUrl,
        browserExecutable,
      });
      console.error(`[render-caption] TIMING ${result.width}x${result.height} ${result.durationSeconds.toFixed(1)}s renderMs=${result.renderMs}`);
      return NextResponse.json({ timing: true, ...result });
    }

    if (!body.renderId) return NextResponse.json({ error: "renderId is required" }, { status: 400 });
    const result = await renderCaptionOnClip(supabase, {
      renderId: body.renderId,
      userId: user.id,
      serveUrl,
      browserExecutable,
    });
    console.error(
      `[render-caption] DONE renderId=${result.renderId} aspect=${result.aspect} ` +
        `${result.width}x${result.height} renderMs=${result.renderMs} asset=${result.creativeAssetId}`,
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[render-caption] ERROR:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    try {
      process.chdir(originalCwd);
    } catch (cwdErr) {
      console.error(`[render-caption] failed to restore cwd: ${cwdErr instanceof Error ? cwdErr.message : cwdErr}`);
    }
  }
}
