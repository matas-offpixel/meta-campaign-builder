/**
 * POST /api/creative-lab/candidates/[id]/import
 *
 * Own-edge candidates only. Download, register, text check, then a clip.
 * anyway uses the stored file and does not download or check again.
 */

import { NextResponse, type NextRequest } from "next/server";

import { readOwnMediaUrl } from "@/lib/creative-lab/ig-discovery";
import { importIgCandidate } from "@/lib/creative-lab/ig-import";
import { probeMp4Bytes } from "@/lib/creative-lab/mp4-probe";
import { judgeOverlay } from "@/lib/creative-lab/overlay-run";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { anyway?: boolean };
  const db = createServiceRoleClient();
  try {
    const result = await importIgCandidate(db, {
      candidateId: id,
      userId: user.id,
      anyway: body.anyway === true,
      mediaUrl: (mediaId) => readOwnMediaUrl(db, user.id, mediaId),
      download: async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer()),
      upload: async (storagePath, bytes) => {
        const saved = await db.storage.from("campaign-assets").upload(storagePath, bytes, { contentType: "video/mp4", upsert: true });
        if (saved.error) throw new Error(saved.error.message);
      },
      probe: (bytes) => probeMp4Bytes(bytes),
      thumbnail: async (path) => {
        const file = await db.storage.from("creative-thumbnails").download(path);
        if (file.error || !file.data) return null;
        return new Uint8Array(await file.data.arrayBuffer());
      },
      check: async ({ times, thumbnail, storagePath }) => {
        const signed = storagePath
          ? await db.storage.from("campaign-assets").createSignedUrl(storagePath, 60 * 30)
          : { data: null };
        const judged = await judgeOverlay({ src: signed.data?.signedUrl ?? null, times, thumbnail });
        return judged;
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not import the clip.";
    const status = /isn't available|database update/i.test(message) ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
