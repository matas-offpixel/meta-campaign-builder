/**
 * lib/mcp/folder-in-deps.ts
 *
 * The real McpFolderDeps for the route (M3d-c, upload_to_event_folder): the
 * export Drive (driveFromEnv, the service account in
 * GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON, supportsAllDrives on every call) and
 * the service-role Storage read. Its writes are folderDepsFor's two
 * (lib/mcp/folder-in/place.ts): files.copy and an upload, each one new
 * tagged file in one folder. No permission, share, move, rename or delete.
 * Not imported by tests (they build folderDepsFor over a spy); the guard
 * test pins exactly what this file imports, and only the route wiring
 * imports it.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { driveFromEnv } from "@/lib/drive/client";
import { folderDepsFor, type McpFolderDeps } from "./folder-in/place";

export function realFolderDeps(db: SupabaseClient): McpFolderDeps {
  return folderDepsFor(driveFromEnv().drive, async (bucket, path) => {
    const res = await db.storage.from(bucket).download(path);
    if (res.error || !res.data) throw new Error("Storage read failed");
    return new Uint8Array(await res.data.arrayBuffer());
  });
}
