/**
 * Short-lived signed URLs so a clip tile can show the file's own frame.
 * A miss leaves previewUrl null; the tile then stays dark instead of
 * inventing initials for a file that exists.
 */

import { createClient } from "@supabase/supabase-js";
import { probeMp4Url } from "./mp4-probe.ts";

const BUCKET = "campaign-assets";
const SIGNED_URL_SECONDS = 60 * 30;

export async function signClipPreviews(
  clips: readonly { id: string; storagePath: string | null }[],
): Promise<Map<string, string>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const signed = new Map<string, string>();
  if (!supabaseUrl || !serviceRoleKey) return signed;
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  await Promise.all(
    clips.map(async (clip) => {
      if (!clip.storagePath) return;
      const { data } = await db.storage.from(BUCKET).createSignedUrl(clip.storagePath, SIGNED_URL_SECONDS);
      if (data?.signedUrl) signed.set(clip.id, data.signedUrl);
    }),
  );
  return signed;
}

/** Pixel size of each signed file. A miss leaves the clip off Best clip. */
export async function measureClipSources(
  clips: readonly { id: string }[],
  signed: ReadonlyMap<string, string>,
): Promise<Map<string, { width: number; height: number }>> {
  const sizes = new Map<string, { width: number; height: number }>();
  await Promise.all(
    clips.map(async (clip) => {
      const url = signed.get(clip.id);
      if (!url) return;
      try {
        const probe = await probeMp4Url(url);
        if (probe.width > 0 && probe.height > 0) sizes.set(clip.id, { width: probe.width, height: probe.height });
      } catch (err) {
        console.error("[creative-lab] clip size probe failed:", clip.id, err instanceof Error ? err.message : err);
      }
    }),
  );
  return sizes;
}
