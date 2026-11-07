/**
 * The cron's import. Same order as the Add button. Loaded only when
 * CREATIVE_LAB_IG_AUTO_IMPORT is "1" and no test double is injected.
 */

import { readOwnMediaUrl } from "./ig-discovery.ts";
import { importIgCandidate } from "./ig-import.ts";
import type { ServiceRoleDb } from "./load.ts";
import { probeMp4Bytes } from "./mp4-probe.ts";
import { judgeOverlay } from "./overlay-run.ts";

type Row = Record<string, unknown>;

export async function importListedCandidate(
  db: ServiceRoleDb,
  args: { userId: string; artistId: string; igMediaId: string },
): Promise<"imported" | "noop" | "other"> {
  const found = await db.from("creative_lab_ig_candidates").select("id").eq("artist_id", args.artistId).eq("ig_media_id", args.igMediaId).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  const id = String((found.data as Row | null)?.id ?? "");
  if (!id) return "other";
  const storage = (db as unknown as {
    storage: {
      from: (bucket: string) => {
        upload: (path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }) => Promise<{ error: { message: string } | null }>;
        download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>;
        createSignedUrl: (path: string, seconds: number) => Promise<{ data: { signedUrl: string } | null }>;
      };
    };
  }).storage;
  const result = await importIgCandidate(db, {
    candidateId: id,
    userId: args.userId,
    mediaUrl: (mediaId) => readOwnMediaUrl(db, args.userId, mediaId),
    download: async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer()),
    upload: async (path, bytes) => {
      const saved = await storage.from("campaign-assets").upload(path, bytes, { contentType: "video/mp4", upsert: true });
      if (saved.error) throw new Error(saved.error.message);
    },
    probe: (bytes) => probeMp4Bytes(bytes),
    thumbnail: async (path) => {
      const file = await storage.from("creative-thumbnails").download(path);
      if (file.error || !file.data) return null;
      return new Uint8Array(await file.data.arrayBuffer());
    },
    check: async ({ times, thumbnail, storagePath }) => {
      const signed = storagePath ? await storage.from("campaign-assets").createSignedUrl(storagePath, 60 * 30) : { data: null };
      return judgeOverlay({ src: signed.data?.signedUrl ?? null, times, thumbnail });
    },
  });
  if (result.outcome === "imported") return "imported";
  if (result.outcome === "noop") return "noop";
  return "other";
}
