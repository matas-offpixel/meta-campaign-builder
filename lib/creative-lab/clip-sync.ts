/**
 * Nightly clip-folder scan. Imports new files only, at most ten per
 * artist. Archived clients are skipped. No Meta calls.
 */

import { loadArchivedClientIds } from "../db/client-status.ts";
import { importArtistClips, type ClipFolderListing, type ClipImportResult, type ClipProbe } from "./clip-intake.ts";
import { fortnightRoom, igAutoImportEnabled, IG_AUTO_CHECKS_PER_RUN } from "./ig-auto.ts";
import { findArtistClips } from "./ig-discovery.ts";
import type { ServiceRoleDb } from "./load.ts";

type Row = Record<string, unknown>;

export const CLIP_SYNC_MAX_NEW = 10;

export type ClipSyncResult = {
  ok: true;
  imported: number;
  failed: number;
  skippedArchived: number;
  artists: number;
  instagram: { enabled: boolean; artists: { artistId: string; discovered: number; checked: number; imported: number; capped: number }[] };
};

export function clipSyncShouldRecord(result: { imported: number; failed: number }): boolean {
  return result.imported > 0 || result.failed > 0;
}

function text(row: Row, key: string): string {
  return String(row[key] ?? "").trim();
}

export async function runClipSync(
  db: ServiceRoleDb,
  opts: {
    archivedClientIds?: ReadonlySet<string>;
    maxNew?: number;
    now?: Date;
    listing?: ClipFolderListing;
    upload?: (storagePath: string, bytes: Buffer, contentType: string) => Promise<void>;
    probe?: (bytes: Buffer, name: string) => ClipProbe | null;
    shareMessage?: () => string;
    importClips?: (artistId: string) => Promise<ClipImportResult>;
    autoImport?: string;
    findClips?: (artistId: string) => Promise<{ candidates: { igMediaId: string; hasFile: boolean; score: number | null }[] }>;
    importCandidate?: (artistId: string, igMediaId: string) => Promise<void>;
  } = {},
): Promise<ClipSyncResult> {
  const archived = opts.archivedClientIds ?? (await loadArchivedClientIds(db));
  const maxNew = opts.maxNew ?? CLIP_SYNC_MAX_NEW;
  const artistsRes = await db.from("creative_lab_artists").select("*");
  if (artistsRes.error) throw new Error(artistsRes.error.message);
  const artists = (artistsRes.data ?? []) as Row[];
  let imported = 0;
  let failed = 0;
  let skippedArchived = 0;
  let considered = 0;
  for (const artist of artists) {
    if (!text(artist, "clip_folder_url")) continue;
    considered += 1;
    if (archived.has(text(artist, "client_id"))) {
      skippedArchived += 1;
      continue;
    }
    try {
      const result = opts.importClips
        ? await opts.importClips(text(artist, "id"))
        : await importArtistClips(db, {
            artistId: text(artist, "id"),
            maxNew,
            now: opts.now,
            listing: opts.listing,
            upload: opts.upload,
            probe: opts.probe,
            shareMessage: opts.shareMessage,
          });
      imported += result.files.filter((file) => file.outcome === "imported").length;
      failed += result.files.filter((file) => file.outcome === "failed").length;
      if (result.folderError) failed += 1;
    } catch {
      failed += 1;
    }
  }
  const instagram = await instagramPass(db, artists, opts);
  imported += instagram.artists.reduce((sum, row) => sum + row.imported, 0);
  return { ok: true, imported, failed, skippedArchived, artists: considered, instagram };
}

async function instagramPass(
  db: ServiceRoleDb,
  artists: Row[],
  opts: { archivedClientIds?: ReadonlySet<string>; now?: Date; autoImport?: string; findClips?: (artistId: string) => Promise<{ candidates: { igMediaId: string; hasFile: boolean; score: number | null }[] }>; importCandidate?: (artistId: string, igMediaId: string) => Promise<void> },
): Promise<{ enabled: boolean; artists: { artistId: string; discovered: number; checked: number; imported: number; capped: number }[] }> {
  const now = opts.now ?? new Date();
  const enabled = igAutoImportEnabled(opts.autoImport);
  const archived = opts.archivedClientIds ?? new Set<string>();
  const targets = artists.filter((row) => text(row, "ig_username") && !archived.has(text(row, "client_id")));
  const counts: { artistId: string; discovered: number; checked: number; imported: number; capped: number }[] = [];
  let checks = IG_AUTO_CHECKS_PER_RUN;
  for (const artist of targets) {
    const artistId = text(artist, "id");
    const found = opts.findClips
      ? await opts.findClips(artistId)
      : await findArtistClips(db, { artistId, now })
          .then((result) => ({ candidates: result.candidates.map((row) => ({ igMediaId: row.igMediaId, hasFile: row.hasFile, score: row.score })) }))
          .catch(() => ({ candidates: [] as { igMediaId: string; hasFile: boolean; score: number | null }[] }));
    const ranked = [...found.candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const recent = await db.from("creative_lab_clips").select("fetched_at").eq("artist_id", artistId).eq("source", "instagram");
    const importedAt = ((recent.data ?? []) as Row[]).map((row) => text(row, "fetched_at")).filter(Boolean);
    const room = enabled ? fortnightRoom(importedAt, now) : 0;
    let checked = 0;
    let imported = 0;
    let capped = 0;
    for (const row of ranked) {
      if (!row.hasFile) continue;
      if (!enabled || checked >= room || checks <= 0) {
        capped += enabled ? 1 : 0;
        continue;
      }
      checks -= 1;
      checked += 1;
      if (opts.importCandidate) {
        await opts.importCandidate(artistId, row.igMediaId);
        imported += 1;
      } else {
        const { importListedCandidate } = await import("./ig-import-live.ts");
        const outcome = await importListedCandidate(db, { userId: text(artist, "user_id"), artistId, igMediaId: row.igMediaId });
        if (outcome === "imported") imported += 1;
      }
    }
    counts.push({ artistId, discovered: found.candidates.length, checked, imported, capped });
  }
  return { enabled, artists: counts };
}
