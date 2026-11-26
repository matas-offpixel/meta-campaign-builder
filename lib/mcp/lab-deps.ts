/**
 * lib/mcp/lab-deps.ts
 *
 * The real McpLabDeps for the route (M3d-b): the Lab's own paths, for one
 * operator. Not imported by tests (they pass spies); the guard test pins
 * exactly what this file imports, and only the route wiring imports it.
 *
 *   - scanAudio: opening the Snippet tab on one act (the snippet route's
 *     GET): scanArtistAudio with intakeDeps over the export Drive
 *     (driveFromEnv), the event and client rows the route reads. It makes
 *     the act's 02 Source / Audio / {artist} folder on first need, reads
 *     new audio files in (Storage copy, creative_lab_audio_files rows) and
 *     renames a row whose Drive file was renamed. Nothing is deleted, moved
 *     or shared.
 *   - saveAudioEdit: the Snippet tab's edit, { kind: "drop" } only
 *     (drop_source operator).
 *   - saveClipOwner: the Clips card's "Whose footage is this"
 *     (creative_lab_clips owner / artist_id / owner_set_by / owner_set_at).
 *   - firstNames: "Drop set by {first name}" as the snippet route reads it
 *     (auth.admin.getUserById → displayName). A first name, never an email.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveAudioEdit } from "@/lib/creative-tests/audio-edits";
import { scanArtistAudio } from "@/lib/creative-tests/audio-intake";
import { intakeDeps } from "@/lib/creative-tests/snippet-server";
import { saveClipOwner } from "@/lib/creative-lab/card-write";
import { driveFromEnv } from "@/lib/drive/client";
import { displayName } from "@/lib/onsale-refresh/line-states";
import type { McpLabDeps } from "./tool-types";

const EVENT_COLS = "id, user_id, client_id, name, event_code, event_date, status, drive_folder_id, drive_folder_linked, drive_cancel_marked_at";

export function realLabDeps(db: SupabaseClient): McpLabDeps {
  return {
    async scanAudio({ userId, eventId, artist }) {
      const { drive } = driveFromEnv();
      if (!drive) return { scanned: false, added: 0, failed: 0 };
      const ev = await db.from("events").select(EVENT_COLS).eq("id", eventId).eq("user_id", userId).maybeSingle();
      if (ev.error || !ev.data) throw new Error("event not readable");
      const event = ev.data as { client_id: string | null };
      if (!event.client_id) return { scanned: false, added: 0, failed: 0 };
      const cl = await db.from("clients").select("id, name, status, drive_folder_id").eq("id", event.client_id).maybeSingle();
      if (cl.error || !cl.data) throw new Error("client not readable");
      const scan = await scanArtistAudio(db, intakeDeps(db, drive), { event: ev.data as never, client: cl.data as never, artist, userId });
      return { scanned: scan.folderId != null, added: scan.added, failed: scan.failed.length };
    },
    async saveAudioEdit({ userId, fileId, edit }) {
      const saved = await saveAudioEdit(db, { fileId, userId, edit });
      if (!saved.ok) return { ok: false, status: saved.status };
      return { ok: true, dropS: saved.row.drop_s == null ? null : Number(saved.row.drop_s) };
    },
    async saveClipOwner(input) {
      await saveClipOwner(db as never, input);
    },
    async firstNames(userIds) {
      const out = new Map<string, string>();
      for (const id of [...new Set(userIds.filter(Boolean))]) {
        const res = await db.auth.admin.getUserById(id);
        const name = res.data.user ? displayName(res.data.user) : null;
        if (name) out.set(id, name);
      }
      return out;
    },
  };
}
