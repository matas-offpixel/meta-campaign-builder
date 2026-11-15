/**
 * Reads and writes the event's clip selection. A missing column or table
 * (migration 217 not applied yet) reads as every usable clip selected.
 */

import type { ServiceRoleDb } from "./load.ts";
import type { ClipSelection, SelectionMode } from "./selection.ts";

type Row = Record<string, unknown>;

function missing(message: string): boolean {
  return /clip_selection_mode|creative_lab_clip_selections|does not exist|schema cache/i.test(message);
}

export async function loadClipSelection(db: ServiceRoleDb, eventId: string): Promise<ClipSelection> {
  const modeRes = await db.from("events").select("clip_selection_mode").eq("id", eventId).maybeSingle();
  const modeError = modeRes.error as { message?: string } | null;
  if (modeError && !missing(modeError.message ?? "")) throw new Error(modeError.message);
  const raw = !modeError ? String((modeRes.data as Row | null)?.clip_selection_mode ?? "") : "";
  const mode: SelectionMode = raw === "chosen" ? "chosen" : "all";
  const rowsRes = await db.from("creative_lab_clip_selections").select("clip_id, selected").eq("event_id", eventId);
  const rowsError = rowsRes.error as { message?: string } | null;
  if (rowsError && !missing(rowsError.message ?? "")) throw new Error(rowsError.message);
  const rows = rowsError
    ? []
    : ((rowsRes.data ?? []) as Row[]).flatMap((row) => {
        const clipId = String(row.clip_id ?? "").trim();
        if (!clipId) return [];
        return [{ clipId, selected: row.selected === true }];
      });
  return { mode, rows };
}

export async function saveClipSelection(
  db: ServiceRoleDb,
  args: { userId: string; eventId: string; selection: ClipSelection },
): Promise<void> {
  const updated = await db.from("events").update({ clip_selection_mode: args.selection.mode }).eq("id", args.eventId);
  if (updated.error) throw new Error(updated.error.message);
  if (args.selection.mode === "all" || args.selection.rows.length === 0) return;
  const now = new Date().toISOString();
  const saved = await db.from("creative_lab_clip_selections").upsert(
    args.selection.rows.map((row) => ({
      event_id: args.eventId,
      clip_id: row.clipId,
      selected: row.selected,
      set_by: args.userId,
      set_at: now,
      user_id: args.userId,
    })),
    { onConflict: "event_id,clip_id" },
  );
  if (saved.error) throw new Error(saved.error.message);
}
