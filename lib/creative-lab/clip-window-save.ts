/**
 * VW4: the operator's nudge, saved. The request is checked against the
 * clip's own drops and VW2's limits (edit-window.ts applyWindowRequest), the
 * window goes into in_s / out_s (and onto the clip's made triple-fit, which
 * cuts the same window), and the clip's video drafts go back to the queue.
 *
 * Drafts only (VW4, VW6): a render on a round (creative_lab_round_ads
 * .render_id, the approved set lib/drive/filing.ts files) is never re-queued
 * or replaced, a render already running finishes, and a static render has
 * no window.
 */

import { applyWindowRequest, parseStoredDrops, type WindowRequest } from "./edit-window.ts";
import type { ServiceRoleDb } from "./load.ts";

type Row = Record<string, unknown>;

const text = (row: Row | null | undefined, key: string) => String(row?.[key] ?? "").trim();

/** Parses the route's body; null when it isn't one of VW4's three requests. */
export function parseWindowRequest(body: unknown): WindowRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  if (b.action === "reset") return { action: "reset" };
  if (b.action === "useDrop" && n(b.dropS) != null) return { action: "useDrop", dropS: n(b.dropS)! };
  if (b.action === "nudge" && n(b.dropS) != null && n(b.dropInS) != null && n(b.lengthS) != null) {
    return { action: "nudge", dropS: n(b.dropS)!, dropInS: n(b.dropInS)!, lengthS: n(b.lengthS)! };
  }
  return null;
}

/** The renders a window change sends back to the queue: video drafts not on any round and not running. */
export function draftsToRequeue(renders: readonly Row[], onRounds: ReadonlySet<string>): string[] {
  return renders
    .filter((r) => text(r, "status") !== "rendering")
    .filter((r) => (text(r, "kind") || "video") === "video")
    .filter((r) => !onRounds.has(text(r, "id")))
    .map((r) => text(r, "id"));
}

export async function saveClipWindow(
  db: ServiceRoleDb,
  args: { clipId: string; userId: string; request: WindowRequest },
): Promise<{ queued: number; inS: number | null; outS: number | null }> {
  const res = await db.from("creative_lab_clips").select("*").eq("id", args.clipId).eq("user_id", args.userId).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  let clip = res.data as Row | null;
  if (!clip) throw new Error("No clip with that id.");
  // A made triple-fit cuts its source's window: the picker on it changes the source.
  if (text(clip, "triple_fit_source_id")) {
    const source = await db.from("creative_lab_clips").select("*").eq("id", text(clip, "triple_fit_source_id")).eq("user_id", args.userId).maybeSingle();
    if (source.error) throw new Error(source.error.message);
    if (!source.data) throw new Error("The triple-fit's source clip is missing.");
    clip = source.data as Row;
  }
  const clipId = text(clip, "id");
  const applied = applyWindowRequest(parseStoredDrops(clip.drops), args.request);
  if (!applied.ok) throw new Error(applied.error);
  const updated = await db.from("creative_lab_clips").update(applied.columns).eq("id", clipId);
  if (updated.error) throw new Error(updated.error.message);
  const made = await db.from("creative_lab_clips").update({ in_s: applied.columns.in_s, out_s: applied.columns.out_s }).eq("triple_fit_source_id", clipId);
  if (made.error) throw new Error(made.error.message);

  const renders = await db.from("creative_lab_renders").select("id, status, kind").eq("clip_id", clipId);
  if (renders.error) throw new Error(renders.error.message);
  const rows = (renders.data ?? []) as Row[];
  const ids = rows.map((r) => text(r, "id")).filter(Boolean);
  const onRounds = new Set<string>();
  if (ids.length) {
    const ads = await db.from("creative_lab_round_ads").select("render_id").in("render_id", ids);
    if (ads.error) throw new Error(ads.error.message);
    for (const ad of (ads.data ?? []) as Row[]) onRounds.add(text(ad, "render_id"));
  }
  let queued = 0;
  for (const id of draftsToRequeue(rows, onRounds)) {
    const update = await db.from("creative_lab_renders").update({ status: "queued", error: null }).eq("id", id);
    if (update.error) throw new Error(update.error.message);
    queued += 1;
  }
  return { queued, inS: applied.columns.in_s, outS: applied.columns.out_s };
}
