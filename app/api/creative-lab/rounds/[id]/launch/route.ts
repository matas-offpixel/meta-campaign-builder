/**
 * POST /api/creative-lab/rounds/[id]/launch
 *
 * Session auth, then the round's owner. CREATIVE_LAB_LAUNCH_ENABLED must
 * be exactly "true" or this returns 503 before any upload, Graph call or
 * database write. Ads are created paused.
 */

import { NextRequest, NextResponse } from "next/server";

import { POST as metaLaunchPost } from "@/app/api/meta/launch-campaign/route";
import { postLabLaunch, type LabUploadRequest } from "@/lib/creative-lab/launch";
import { LAB_LAUNCHES_OFF, labLaunchesEnabled } from "@/lib/creative-lab/killswitch";
import { handleUploadAsset } from "@/lib/meta/upload-asset-handler";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!labLaunchesEnabled()) {
    return NextResponse.json({ error: LAB_LAUNCHES_OFF }, { status: 503 });
  }
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await postLabLaunch(id, user?.id ?? null, {
    db: createServiceRoleClient(),
    upload: (body) => uploadRender(body),
    launch: (body) => callLaunch(req, body),
  });
  return NextResponse.json(result.body, { status: result.status });
}

async function uploadRender(body: LabUploadRequest): Promise<{ videoId: string; registryAssetId?: string | null }> {
  const res = await handleUploadAsset(
    new Request("http://internal/api/meta/upload-asset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const json = (await res.json()) as { error?: string; videoId?: string; registryAssetId?: string | null };
  if (!res.ok || !json.videoId) throw new Error(json.error || "upload failed");
  return { videoId: json.videoId, registryAssetId: json.registryAssetId };
}

async function callLaunch(req: NextRequest, body: { draft: unknown; createPaused: true }): Promise<{
  ok: boolean;
  status: number;
  launchRunId?: string;
  error?: string;
  creativesFailed?: { name: string; error: string }[];
}> {
  const launchReq = new NextRequest(new URL("/api/meta/launch-campaign", req.url), {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify(body),
  });
  const res = await metaLaunchPost(launchReq);
  const json = (await res.json()) as {
    launchRunId?: string;
    error?: string;
    creativesFailed?: { name: string; error: string }[];
  };
  return { ok: res.ok, status: res.status, launchRunId: json.launchRunId, error: json.error, creativesFailed: json.creativesFailed };
}
