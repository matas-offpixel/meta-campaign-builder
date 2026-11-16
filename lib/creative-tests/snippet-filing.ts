/**
 * CT1 / CT10: an approved snippet files to Drive by S14, under Videos for the
 * track's artist (D1, D2), in the stage folder a Lab render of today goes to
 * (D4). Never overwrites: a name already in the folder gets _v2, _v3 (S14).
 * The render row's own status is never touched; launch reads Storage.
 *
 * "A snippet is approved like any render" (CT10): approved_at on the row.
 * Run from the Drive tick after the caption renders' filing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { APP_ID_KEY, APP_TAG_KEY, type DriveApi } from "../drive/client.ts";
import type { DriveDb } from "../drive/db.ts";
import { emptyLog, ensureRouteFolder, type ClientRow, type EventRow, type TreeLog } from "../drive/folders.ts";
import { labArtistFolderName } from "../drive/owner.ts";
import { isCancelled, renderStage, routeRender, type CycleCalendar } from "../drive/tree.ts";
import { isArchivedClientStatus } from "../db/client-status.ts";
import { AUDIO_BUCKET } from "./audio-intake.ts";

type Db = Pick<SupabaseClient, "from">;

export type SnippetFilingRow = {
  id: string;
  event_id: string;
  audio_file_id: string;
  status: string;
  approved_at: string | null;
  storage_path: string | null;
  file_name: string | null;
  drive_status: string | null;
  drive_error: string | null;
  updated_at: string;
};

export function wantsSnippetFiling(row: Pick<SnippetFilingRow, "status" | "approved_at" | "drive_status" | "storage_path" | "file_name">): boolean {
  return row.status === "done" && Boolean(row.approved_at) && Boolean(row.storage_path) && Boolean(row.file_name) && row.drive_status == null;
}

/** S14's never-overwrite: …_r1_9x16.mp4, then …_r1_v2_9x16.mp4, _v3, … */
export function freeSnippetName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const match = /^(.*_r\d+)(_9x16\.mp4)$/.exec(name);
  if (!match) throw new Error(`not a snippet name: ${name}`);
  for (let v = 2; v < 1000; v += 1) {
    const next = `${match[1]}_v${v}${match[2]}`;
    if (!taken.has(next)) return next;
  }
  throw new Error("no free file name");
}

export type SnippetFileResult = { ok: true; renderId: string; fileName: string } | { ok: false; renderId: string; skipped: string } | { ok: false; renderId: string; error: string };

export async function fileSnippetRender(
  rawDb: Db,
  drive: DriveApi,
  row: SnippetFilingRow,
  deps: { download: (bucket: string, storagePath: string) => Promise<Uint8Array>; now: Date; today: string; calendar?: CycleCalendar; log?: TreeLog },
): Promise<SnippetFileResult> {
  const db = rawDb as unknown as DriveDb;
  const one = async <T>(table: string, column: string, value: string): Promise<T | null> => {
    const res = await rawDb.from(table).select("*").eq(column, value).maybeSingle();
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
    return (res.data as T | null) ?? null;
  };
  const event = await one<EventRow & { client_id: string }>("events", "id", row.event_id);
  if (!event) return { ok: false, renderId: row.id, skipped: "no_event" };
  const client = await one<ClientRow>("clients", "id", event.client_id);
  if (!client) return { ok: false, renderId: row.id, skipped: "no_client" };
  if (isArchivedClientStatus(client.status)) return { ok: false, renderId: row.id, skipped: "archived_client" };
  if (isCancelled(event.status)) return { ok: false, renderId: row.id, skipped: "cancelled" };
  if (!event.drive_folder_id) return { ok: false, renderId: row.id, skipped: "no_tree" };
  const audio = await one<{ artist_id: string | null }>("creative_lab_audio_files", "id", row.audio_file_id);
  if (!audio?.artist_id) return { ok: false, renderId: row.id, skipped: "no_artist" };
  // D2: the owner folder is the Lab artist's (creative_lab_artists, per client), linked to the library artist.
  const labRes = await rawDb.from("creative_lab_artists").select("*").eq("client_id", client.id).eq("artist_id", audio.artist_id).limit(1);
  if (labRes.error) throw new Error(`creative_lab_artists: ${labRes.error.message}`);
  const labArtist = ((labRes.data ?? []) as { id: string; name: string; artist_id: string | null }[])[0];
  if (!labArtist) return { ok: false, renderId: row.id, skipped: "no_artist" };

  const mark = async (patch: Record<string, unknown>) => {
    const res = await rawDb.from("creative_lab_snippet_renders").update(patch).eq("id", row.id);
    if (res.error) throw new Error(`creative_lab_snippet_renders: ${res.error.message}`);
  };
  try {
    const owner = { kind: "artist" as const, artistId: labArtist.id, name: await labArtistFolderName(db, labArtist as never) };
    const route = routeRender({ stage: renderStage(event.status), today: deps.today, eventDate: event.event_date ?? null, calendar: deps.calendar, owner, kind: "video" });
    const folderId = await ensureRouteFolder(db, drive, event, client, route, deps.log ?? emptyLog());
    const taken = new Set((await drive.listChildren(folderId)).map((f) => f.name));
    const name = freeSnippetName(String(row.file_name), taken);
    const bytes = await deps.download(AUDIO_BUCKET, String(row.storage_path));
    const file = await drive.uploadFile({ parentId: folderId, name, mimeType: "video/mp4", bytes, appProperties: { [APP_TAG_KEY]: "lab_snippet", [APP_ID_KEY]: row.id } });
    await mark({ drive_status: "copied", drive_file_id: file.id, file_name: name, drive_error: null });
    return { ok: true, renderId: row.id, fileName: name };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).replace(/https?:\/\/\S+/g, "").slice(0, 300);
    // One try a tick: a failure waits for Retry on the render row (migration 255 keeps no try count here).
    await mark({ drive_status: "failed", drive_error: message });
    return { ok: false, renderId: row.id, error: message };
  }
}
