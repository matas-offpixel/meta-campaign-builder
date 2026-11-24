/**
 * CT10's "Static: {name}": the event's 9:16 statics, read from its Drive
 * {owner} / Statics folders (Matas, 16 Nov: the S14-named 9:16 files there).
 * The app keeps no list of approved statics; a file filed in a Statics
 * folder is one. Its 4:5 and 1:1 siblings stay stills and aren't touched
 * (CT1).
 *
 * The chosen static is copied to Storage for the preview and the render;
 * the Drive file is only read.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DriveApi, DriveFile } from "../drive/client.ts";
import { extensionOf } from "./snippet.ts";

type Db = Pick<SupabaseClient, "from">;

export type EventStatic = { driveFileId: string; name: string; fileName: string; folderKey: string; mimeType: string };

/** A 9:16 still by its name: "…_9x16.png", or the judged winner's "…_9x16_winner.png". */
const NINE_SIXTEEN_STILL = /_9x16(?:_winner)?\.(png|jpe?g|webp)$/i;

/** {owner} / Statics folder keys in the event's map (D4, D5): "{stage}/owner/{owner}/statics". */
export function isStaticsKey(key: string): boolean {
  return /\/owner\/(?:artist:[^/]+|promoter)\/statics$/.test(key);
}

export function isNineSixteenStill(file: Pick<DriveFile, "name" | "mimeType" | "trashed">): boolean {
  return !file.trashed && (file.mimeType ?? "").startsWith("image/") && NINE_SIXTEEN_STILL.test(file.name);
}

/** The static's name for CT10's label and CT1's file name: the file name without its extension. */
export function staticName(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
}

/**
 * CT1's {static} inside the snippet's own name: the static's S14 name less
 * the event code in front and the ratio at the end, which the snippet's name
 * already carries once each.
 */
export function staticSlugForName(fileName: string, eventCode: string | null): string {
  let stem = staticName(fileName).replace(/_9x16(?:_winner)?$/i, "");
  const code = eventCode?.trim();
  if (code && stem.startsWith(`${code}_`)) stem = stem.slice(code.length + 1);
  return stem;
}

export async function listEventStatics(db: Db, drive: DriveApi, eventId: string): Promise<EventStatic[]> {
  const res = await db.from("drive_folders").select("key, drive_folder_id").eq("event_id", eventId).range(0, 999);
  if (res.error) throw new Error(`drive_folders: ${res.error.message}`);
  const folders = ((res.data ?? []) as { key: string; drive_folder_id: string }[]).filter((row) => isStaticsKey(row.key));
  const seen = new Set<string>();
  const out: EventStatic[] = [];
  for (const folder of folders) {
    for (const file of await drive.listChildren(folder.drive_folder_id)) {
      if (!isNineSixteenStill(file) || seen.has(file.id)) continue;
      seen.add(file.id);
      out.push({ driveFileId: file.id, name: staticName(file.name), fileName: file.name, folderKey: folder.key, mimeType: file.mimeType });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function staticStoragePath(eventId: string, driveFileId: string, mimeType: string, fileName = ""): string {
  const ext = extensionOf(fileName) || (mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg");
  return `images/creative-lab/snippet-statics/${eventId}/${driveFileId}.${ext}`;
}
