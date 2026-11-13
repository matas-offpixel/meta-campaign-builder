/**
 * Caption renders per cron tick, oldest queued first.
 *
 * At most MAX_LAB_RENDERS_AT_ONCE renders are in flight across ticks: a
 * tick claims only the slots that rows already rendering leave free, and
 * runs its claims side by side. Each render fans out to at most
 * MAX_FUNCTIONS_PER_CAPTION_RENDER Lambda functions. A row stuck in rendering for
 * 15 minutes is failed, and its round ad becomes render_failed. The judge
 * never sees that: verdict stays untouched.
 *
 * Archived clients are skipped. The row stays queued.
 */

import { loadArchivedClientScope } from "../db/client-status.ts";
import { faceSampleState, readFaceSamples } from "./caption-placement.ts";
import { MAX_LAB_RENDERS_AT_ONCE } from "./lambda.ts";
import type { ServiceRoleDb } from "./load.ts";
import { isSamplesPending, renderCaptionOnClip } from "./render.ts";

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

/** A clip with no row is ready: the caller has nothing to sample. One entry per clip id that exists. */
async function clipReadiness(db: ServiceRoleDb, queued: readonly Row[]): Promise<Map<string, "ready" | "failed" | "checking">> {
  const ids = [...new Set(queued.map((row) => String(row.clip_id ?? "")).filter(Boolean))];
  const out = new Map<string, "ready" | "failed" | "checking">();
  for (const id of ids) {
    const res = await db.from("creative_lab_clips").select("crop_focus_x, crop_focus_y, in_s, out_s, face_samples").eq("id", id).maybeSingle();
    if (res.error) throw new Error(`creative_lab_clips: ${res.error.message}`);
    const clip = res.data as Row | null;
    if (!clip) continue;
    const num = (value: unknown): number | null => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
    out.set(id, faceSampleState(readFaceSamples(clip.face_samples), {
      cropFocusX: num(clip.crop_focus_x) ?? 0.5,
      cropFocusY: num(clip.crop_focus_y) ?? 0.5,
      inS: num(clip.in_s),
      outS: num(clip.out_s),
    }));
  }
  return out;
}

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
    maxAtOnce?: number;
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
  const slots = Math.max(0, (opts.maxAtOnce ?? MAX_LAB_RENDERS_AT_ONCE) - stillRendering);
  if (slots === 0) {
    return { ok: true, claimed: 0, timedOut, skippedArchived: 0, busy: true };
  }

  const queuedRes = await db.from("creative_lab_renders").select("*").eq("status", "queued").order("created_at", { ascending: true });
  if (queuedRes.error) throw new Error(`creative_lab_renders: ${queuedRes.error.message}`);
  const queued = (queuedRes.data ?? []) as Row[];
  const readiness = await clipReadiness(db, queued);
  const pending = [...readiness.entries()].find(([, state]) => state === "checking");
  if (pending && !opts.render) {
    const { ensureClipFaces } = await import("./caption-place-run.ts");
    const detected = await ensureClipFaces(db, pending[0]);
    readiness.set(pending[0], detected);
  }
  let skippedArchived = 0;
  const claimed: Row[] = [];
  for (const row of queued) {
    const clipId = String(row.clip_id ?? "");
    if (clipId && readiness.get(clipId) !== "ready" && readiness.has(clipId)) continue;
    if (claimed.length >= slots) break;
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
    claimed.push(row);
  }

  const render = opts.render ?? (async (renderId: string, userId: string) => {
    await renderCaptionOnClip(db, { renderId, userId });
    const { recordPlacementContrast } = await import("./caption-place-run.ts");
    await recordPlacementContrast(db, renderId).catch((err: unknown) => {
      console.error("[creative-lab-render-tick] contrast", err instanceof Error ? err.message : err);
    });
  });
  const rounds = await Promise.all(
    claimed.map(async (row) => {
      try {
        await render(String(row.id), String(row.user_id));
        return await markAds(db, String(row.id), "ready", null);
      } catch (err) {
        if (isSamplesPending(err)) return [];
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        await db.from("creative_lab_renders").update({ status: "failed", error: message }).eq("id", row.id).eq("status", "rendering");
        return await markAds(db, String(row.id), "render_failed", message);
      }
    }),
  );
  await refreshRounds(db, rounds.flat());
  return { ok: true, claimed: claimed.length, timedOut, skippedArchived, busy: false };
}
