/**
 * One caption render per cron tick, oldest queued first.
 *
 * A second tick does not start a render while one is still rendering,
 * because the Lambda quota is one function. A row stuck in rendering for
 * 15 minutes is failed, and its round ad becomes render_failed. The judge
 * never sees that: verdict stays untouched.
 *
 * Archived clients are skipped. The row stays queued.
 */

import { loadArchivedClientScope } from "../db/client-status.ts";
import type { ServiceRoleDb } from "./load.ts";
import { renderCaptionOnClip } from "./render.ts";

export const RENDER_STUCK_MS = 15 * 60 * 1000;

type Row = Record<string, unknown>;

export type RenderTickResult = {
  ok: true;
  claimed: number;
  timedOut: number;
  skippedArchived: number;
  busy: boolean;
  skippedReason?: string;
};

async function rows(db: ServiceRoleDb, table: string, column: string, value: unknown): Promise<Row[]> {
  const res = await db.from(table).select("*").eq(column, value);
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data ?? []) as Row[];
}

async function refreshRounds(db: ServiceRoleDb, roundIds: readonly string[]): Promise<void> {
  for (const roundId of [...new Set(roundIds)]) {
    const roundRes = await db.from("creative_lab_rounds").select("id, status").eq("id", roundId).maybeSingle();
    if (roundRes.error) throw new Error(`creative_lab_rounds: ${roundRes.error.message}`);
    const round = roundRes.data as { status?: string } | null;
    if (round?.status !== "rendering") continue;
    const ads = await rows(db, "creative_lab_round_ads", "round_id", roundId);
    const settled = ads.length > 0 && ads.every((ad) => ad.launch_state === "ready" || ad.launch_state === "render_failed");
    if (!settled) continue;
    const update = await db.from("creative_lab_rounds").update({ status: "draft" }).eq("id", roundId);
    if (update.error) throw new Error(`creative_lab_rounds update: ${update.error.message}`);
  }
}

async function markAds(
  db: ServiceRoleDb,
  renderId: string,
  launchState: "ready" | "render_failed",
  launchError: string | null,
): Promise<string[]> {
  const update = await db
    .from("creative_lab_round_ads")
    .update({ launch_state: launchState, launch_error: launchError })
    .eq("render_id", renderId)
    .eq("launch_state", "pending")
    .select("round_id");
  if (update.error) throw new Error(`creative_lab_round_ads update: ${update.error.message}`);
  return ((update.data ?? []) as { round_id?: string }[]).map((row) => String(row.round_id)).filter(Boolean);
}

export async function runRenderTick(
  db: ServiceRoleDb,
  opts: {
    now?: Date;
    archivedEventIds?: ReadonlySet<string>;
    render?: (renderId: string, userId: string) => Promise<void>;
    remotionEnabled?: boolean;
  } = {},
): Promise<RenderTickResult> {
  if (opts.remotionEnabled === false) {
    return { ok: true, claimed: 0, timedOut: 0, skippedArchived: 0, busy: false, skippedReason: "remotion_off" };
  }
  const now = opts.now ?? new Date();
  const archived = opts.archivedEventIds ?? (await loadArchivedClientScope(db)).eventIds;
  const cutoff = new Date(now.getTime() - RENDER_STUCK_MS).toISOString();

  const rendering = await rows(db, "creative_lab_renders", "status", "rendering");
  const stuck = rendering.filter((row) => row.updated_at != null && String(row.updated_at) < cutoff);
  let timedOut = 0;
  const touched: string[] = [];
  for (const row of stuck) {
    const update = await db.from("creative_lab_renders").update({ status: "failed", error: "timeout" }).eq("id", row.id).eq("status", "rendering");
    if (update.error) throw new Error(`creative_lab_renders timeout: ${update.error.message}`);
    touched.push(...(await markAds(db, String(row.id), "render_failed", "timeout")));
    timedOut += 1;
  }
  await refreshRounds(db, touched);

  const stillRendering = (await rows(db, "creative_lab_renders", "status", "rendering")).length;
  if (stillRendering > 0) {
    return { ok: true, claimed: 0, timedOut, skippedArchived: 0, busy: true };
  }

  const queuedRes = await db.from("creative_lab_renders").select("*").eq("status", "queued").order("created_at", { ascending: true });
  if (queuedRes.error) throw new Error(`creative_lab_renders: ${queuedRes.error.message}`);
  const queued = (queuedRes.data ?? []) as Row[];
  let skippedArchived = 0;
  for (const row of queued) {
    const captionRes = await db.from("creative_lab_captions").select("event_id").eq("id", String(row.caption_id)).maybeSingle();
    if (captionRes.error) throw new Error(`creative_lab_captions: ${captionRes.error.message}`);
    const eventId = (captionRes.data as { event_id?: string } | null)?.event_id;
    if (eventId && archived.has(eventId)) {
      skippedArchived += 1;
      continue;
    }
    const claim = await db
      .from("creative_lab_renders")
      .update({ status: "rendering", error: null })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id");
    if (claim.error) throw new Error(`creative_lab_renders claim: ${claim.error.message}`);
    if (!((claim.data ?? []) as unknown[]).length) continue;
    const render = opts.render ?? ((renderId: string, userId: string) => renderCaptionOnClip(db, { renderId, userId }).then(() => undefined));
    try {
      await render(String(row.id), String(row.user_id));
      const rounds = await markAds(db, String(row.id), "ready", null);
      await refreshRounds(db, rounds);
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await db.from("creative_lab_renders").update({ status: "failed", error: message }).eq("id", row.id).eq("status", "rendering");
      const rounds = await markAds(db, String(row.id), "render_failed", message);
      await refreshRounds(db, rounds);
    }
    return { ok: true, claimed: 1, timedOut, skippedArchived, busy: false };
  }
  return { ok: true, claimed: 0, timedOut, skippedArchived, busy: false };
}
