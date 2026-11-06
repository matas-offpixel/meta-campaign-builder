/**
 * Nightly clip-folder scan. Imports new files only, at most ten per
 * artist. Archived clients are skipped. No Meta calls.
 */

import { loadArchivedClientIds } from "../db/client-status.ts";
import { importArtistClips, type ClipFolderListing, type ClipImportResult, type ClipProbe } from "./clip-intake.ts";
import type { ServiceRoleDb } from "./load.ts";

type Row = Record<string, unknown>;

export const CLIP_SYNC_MAX_NEW = 10;

export type ClipSyncResult = {
  ok: true;
  imported: number;
  failed: number;
  skippedArchived: number;
  artists: number;
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
    if (!text(artist, "clip_folder_url") || !text(artist, "approved_at")) continue;
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
  return { ok: true, imported, failed, skippedArchived, artists: considered };
}
