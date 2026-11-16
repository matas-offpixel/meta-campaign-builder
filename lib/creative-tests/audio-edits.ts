/**
 * The operator's edits to an audio file (CT2–CT4, TT5): who supplied it, the
 * Spotify match, the drop marker, the window and its length, and clearing a
 * rights flag. Each edit is a patch worked out here (pure) and written by
 * `saveAudioEdit`, scoped to the operator's own rows.
 *
 * - Supplier (CT2): picked once, stored with who picked it and when.
 * - Match (CT3): an operator confirms a suggested track, or picks one; a
 *   file in no top track is picked as itself (own_track).
 * - Drop (CT4): dragging the marker sets the drop and moves the window with
 *   it ("Drop set by {first name}").
 * - Window (CT4): dragging the window moves the start alone.
 * - Length (CT4): 15 to 20 s, the window keeps its start.
 * - Clear the flag (TT5): only Matas clears it; the route checks who.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AudioFileRow } from "./audio-intake.ts";
import { clampLength, clampWindow, type Supplier } from "./snippet.ts";

type Db = Pick<SupabaseClient, "from">;

export type AudioEdit =
  | { kind: "supplier"; supplier: Supplier }
  | { kind: "match"; trackId: string; title: string }
  | { kind: "own_track" }
  | { kind: "unmatch" }
  | { kind: "drop"; dropS: number }
  | { kind: "window"; startS: number }
  | { kind: "length"; lengthS: number }
  | { kind: "clear_flag" };

export type EditRefusal = { refused: string };

export function isSupplier(value: unknown): value is Supplier {
  return value === "client" || value === "artist_team";
}

/** The columns an edit writes, or why it can't be made. */
export function editPatch(row: AudioFileRow, edit: AudioEdit, by: string, now: string): Record<string, unknown> | EditRefusal {
  const duration = Number(row.duration_s ?? 0);
  switch (edit.kind) {
    case "supplier":
      if (!isSupplier(edit.supplier)) return { refused: "Pick who supplied the file." };
      if (row.supplier) return { refused: "Who supplied this file is already recorded." };
      return { supplier: edit.supplier, supplier_set_by: by, supplier_set_at: now };
    case "match":
      if (row.unusable_reason) return { refused: "This file can't be used." };
      return { spotify_track_id: edit.trackId, spotify_title: edit.title, match_state: "matched", matched_by: by, matched_at: now };
    case "own_track":
      // CT3: a Drive file that matches no top track is picked as itself.
      if (row.unusable_reason) return { refused: "This file can't be used." };
      return { spotify_track_id: null, spotify_title: null, match_state: "matched", matched_by: by, matched_at: now };
    case "unmatch":
      return { spotify_track_id: null, spotify_title: null, match_state: "none", matched_by: null, matched_at: null };
    case "drop": {
      if (!(duration > 0) || !Number.isFinite(edit.dropS)) return { refused: "This file has no length to place a drop in." };
      const dropS = Math.round(Math.min(duration, Math.max(0, edit.dropS)) * 1000) / 1000;
      const win = clampWindow(dropS - 4, duration, clampLength(row.length_s));
      return { drop_s: dropS, drop_source: "operator", drop_set_by: by, drop_set_at: now, window_start_s: win.startS, length_s: win.lengthS };
    }
    case "window": {
      if (row.drop_s == null) return { refused: "Place the drop marker first." };
      const win = clampWindow(edit.startS, duration, clampLength(row.length_s));
      return { window_start_s: win.startS };
    }
    case "length": {
      const lengthS = clampLength(edit.lengthS);
      const win = clampWindow(Number(row.window_start_s ?? 0), duration, lengthS);
      return { length_s: lengthS, window_start_s: row.window_start_s == null ? null : win.startS };
    }
    case "clear_flag":
      if (!row.rights_flag) return { refused: "This file isn't flagged." };
      return { rights_flag: null, rights_flag_cleared_by: by, rights_flag_cleared_at: now };
  }
}

export async function saveAudioEdit(db: Db, input: { fileId: string; userId: string; edit: AudioEdit; now?: Date }): Promise<{ ok: true; row: AudioFileRow } | { ok: false; error: string; status: number }> {
  const read = await db.from("creative_lab_audio_files").select("*").eq("id", input.fileId).eq("user_id", input.userId).maybeSingle();
  if (read.error) throw new Error(`creative_lab_audio_files: ${read.error.message}`);
  const row = read.data as AudioFileRow | null;
  if (!row) return { ok: false, error: "No audio file with that id.", status: 404 };
  const patch = editPatch(row, input.edit, input.userId, (input.now ?? new Date()).toISOString());
  if ("refused" in patch) return { ok: false, error: String(patch.refused), status: 409 };
  const write = await db.from("creative_lab_audio_files").update(patch).eq("id", row.id).select("*").maybeSingle();
  if (write.error) throw new Error(`creative_lab_audio_files: ${write.error.message}`);
  return { ok: true, row: write.data as AudioFileRow };
}
