/**
 * lib/render-templates/store.ts — render packages in the database
 * (migration 270): start one under the cost guard, its file rows, Try again,
 * Render as round {round+1}, and settling a package once every file has.
 *
 * Cost guard (item 6), server-side:
 *   - one package at a time per event: a running package refuses the next
 *     (and the partial unique index refuses a race);
 *   - a loop can't start a second package within 60 s of the last for the
 *     same event and recipe.
 * The AWS billing alarm stays the backstop.
 *
 * Relative imports only (node:test).
 */

import { buildRenderFileName, ctaSlugForStage, NO_CTA, type MontageVariant, type Ratio } from "./file-name.ts";
import type { Db } from "./load.ts";
import type { MontagePlan } from "./montage-plan.ts";
import { fileRights, type RenderOwner } from "./rights.ts";
import { candidate, recipeWord, type Recipe, type Stage } from "./words.ts";

export const LOOP_GUARD_MS = 60_000;
export const MONTAGE_STYLE_VERSION = "m4-montage-v1";

export type StartInput = {
  userId: string;
  eventId: string;
  eventCode: string;
  clientId: string;
  recipe: Recipe;
  stage: Stage;
  source: "lab" | "claude";
  owner: RenderOwner;
  files: readonly { variant: MontageVariant; ratio: Ratio }[];
  picks: { clipIds: string[]; trackId: string; voice: "promoter" | "artist" };
  plan: MontagePlan;
  approval: { asked: string; answer: string } | null;
  now: Date;
  /** The round, when re-rendering; otherwise the event's next round for this recipe. */
  round?: number;
};

export type StartResult =
  | { ok: true; packageId: string; round: number; fileNames: string[] }
  | { ok: false; refused: "busy" | "too_soon"; text: string };

type Row = Record<string, unknown>;

/** The guard alone, so a caller can refuse before any track download or plan. */
export async function costGuard(db: Db, input: { eventId: string; eventCode: string; recipe: Recipe; now: Date }): Promise<StartResult | null> {
  const running = await db.from("creative_lab_render_packages").select("id").eq("event_id", input.eventId).eq("status", "rendering").limit(1);
  if (running.error) throw new Error(`creative_lab_render_packages: ${running.error.message}`);
  if ((running.data ?? []).length) return { ok: false, refused: "busy", text: candidate("busy", { code: input.eventCode }) };
  const last = await db
    .from("creative_lab_render_packages")
    .select("created_at")
    .eq("event_id", input.eventId)
    .contains("recipes", [input.recipe])
    .order("created_at", { ascending: false })
    .limit(1);
  if (last.error) throw new Error(`creative_lab_render_packages: ${last.error.message}`);
  const at = (last.data?.[0] as Row | undefined)?.created_at;
  if (at && input.now.getTime() - Date.parse(String(at)) < LOOP_GUARD_MS) {
    return { ok: false, refused: "too_soon", text: candidate("tooSoon", { code: input.eventCode, recipe: recipeWord(input.recipe) }) };
  }
  return null;
}

export async function nextRound(db: Db, eventId: string, recipe: Recipe): Promise<number> {
  const res = await db.from("creative_lab_render_packages").select("round_no").eq("event_id", eventId).contains("recipes", [recipe]).order("round_no", { ascending: false }).limit(1);
  if (res.error) throw new Error(`creative_lab_render_packages: ${res.error.message}`);
  const top = Number((res.data?.[0] as Row | undefined)?.round_no ?? 0);
  return top + 1;
}

export function fileNameFor(input: { eventCode: string; owner: RenderOwner; recipe: Recipe; variant: MontageVariant; stage: Stage; round: number; ratio: Ratio }): string {
  return buildRenderFileName({
    eventCode: input.eventCode,
    owner: input.owner.kind === "offpixel" ? { kind: "offpixel" } : { kind: input.owner.kind, slug: input.owner.slug },
    recipe: input.recipe,
    variant: input.variant,
    ctaSlug: input.variant === "no-text" ? NO_CTA : ctaSlugForStage(input.stage),
    round: input.round,
    ratio: input.ratio,
    ext: "mp4",
  });
}

/** Start a package: the guard, the package row, one queued row per file. Nothing renders here; the tick does. */
export async function startPackage(db: Db, input: StartInput): Promise<StartResult> {
  const guarded = await costGuard(db, input);
  if (guarded) return guarded;
  const round = input.round ?? (await nextRound(db, input.eventId, input.recipe));
  const insert = await db
    .from("creative_lab_render_packages")
    .insert({
      user_id: input.userId,
      event_id: input.eventId,
      client_id: input.clientId,
      recipes: [input.recipe],
      source: input.source,
      status: "rendering",
      stage: input.stage,
      round_no: round,
      file_count: input.files.length,
      picks: input.picks,
      plan: input.plan,
      approval_asked: input.approval?.asked ?? null,
      approval_answer: input.approval?.answer ?? null,
      approved_at: input.approval ? input.now.toISOString() : null,
    })
    .select("id")
    .single();
  if (insert.error) {
    // The one-running index: another start won the race.
    if (/duplicate key|unique/i.test(insert.error.message)) return { ok: false, refused: "busy", text: candidate("busy", { code: input.eventCode }) };
    throw new Error(`creative_lab_render_packages: ${insert.error.message}`);
  }
  const packageId = String((insert.data as Row).id);
  const fileNames: string[] = [];
  const rows = input.files.map((f) => {
    const name = fileNameFor({ eventCode: input.eventCode, owner: input.owner, recipe: input.recipe, variant: f.variant, stage: input.stage, round, ratio: f.ratio });
    fileNames.push(name);
    const rights = fileRights(input.owner, f.variant !== "no-text", input.clientId);
    return {
      user_id: input.userId,
      package_id: packageId,
      recipe: input.recipe,
      file_name: name,
      variant: f.variant,
      aspect: f.ratio,
      round_no: round,
      owner_kind: input.owner.kind,
      rights_shareable: rights.shareable,
      rights_held_reason: rights.heldReason,
      kind: "video",
      style_version: MONTAGE_STYLE_VERSION,
      status: "queued",
      attempt: 1,
    };
  });
  const files = await db.from("creative_lab_renders").insert(rows);
  if (files.error) {
    await db.from("creative_lab_render_packages").delete().eq("id", packageId);
    throw new Error(`creative_lab_renders: ${files.error.message}`);
  }
  return { ok: true, packageId, round, fileNames };
}

/** Try again on a file that didn't render: back to queued, its package rendering again (one at a time per event). */
export async function retryFile(db: Db, input: { renderId: string; userId: string; eventCode: string }): Promise<{ ok: true } | { ok: false; text: string }> {
  const row = await db.from("creative_lab_renders").select("id, package_id, status, attempt, user_id").eq("id", input.renderId).maybeSingle();
  if (row.error) throw new Error(`creative_lab_renders: ${row.error.message}`);
  const r = row.data as Row | null;
  if (!r || String(r.user_id) !== input.userId || !r.package_id || r.status !== "failed") return { ok: false, text: "" };
  const pkg = await db.from("creative_lab_render_packages").select("id, event_id, status").eq("id", String(r.package_id)).maybeSingle();
  if (pkg.error) throw new Error(`creative_lab_render_packages: ${pkg.error.message}`);
  const p = pkg.data as Row | null;
  if (!p) return { ok: false, text: "" };
  if (p.status !== "rendering") {
    const other = await db.from("creative_lab_render_packages").select("id").eq("event_id", String(p.event_id)).eq("status", "rendering").limit(1);
    if (other.error) throw new Error(`creative_lab_render_packages: ${other.error.message}`);
    if ((other.data ?? []).length) return { ok: false, text: candidate("busy", { code: input.eventCode }) };
    const reopen = await db.from("creative_lab_render_packages").update({ status: "rendering", finished_at: null }).eq("id", String(p.id)).eq("status", "done");
    if (reopen.error) throw new Error(`creative_lab_render_packages: ${reopen.error.message}`);
  }
  const update = await db
    .from("creative_lab_renders")
    .update({ status: "queued", error: null, attempt: Number(r.attempt ?? 1) + 1 })
    .eq("id", input.renderId)
    .eq("status", "failed");
  if (update.error) throw new Error(`creative_lab_renders: ${update.error.message}`);
  return { ok: true };
}

/** Settle every running package whose files have all finished (done or failed). Returns the ids settled. */
export async function settlePackages(db: Db, now: Date): Promise<string[]> {
  const running = await db.from("creative_lab_render_packages").select("id").eq("status", "rendering").range(0, 199);
  if (running.error) throw new Error(`creative_lab_render_packages: ${running.error.message}`);
  const settled: string[] = [];
  for (const p of (running.data ?? []) as Row[]) {
    const files = await db.from("creative_lab_renders").select("status").eq("package_id", String(p.id));
    if (files.error) throw new Error(`creative_lab_renders: ${files.error.message}`);
    const rows = (files.data ?? []) as Row[];
    if (!rows.length || rows.some((r) => r.status === "queued" || r.status === "rendering")) continue;
    const done = await db.from("creative_lab_render_packages").update({ status: "done", finished_at: now.toISOString() }).eq("id", String(p.id)).eq("status", "rendering");
    if (done.error) throw new Error(`creative_lab_render_packages: ${done.error.message}`);
    settled.push(String(p.id));
  }
  return settled;
}

/** Cache a track's beat grid with the drop it was read for (migration 270). */
export async function saveBeatGrid(db: Db, audioFileId: string, grid: object, dropS: number, now: Date): Promise<void> {
  const res = await db.from("creative_lab_audio_files").update({ beat_grid: { ...grid, dropS }, beat_grid_at: now.toISOString() }).eq("id", audioFileId);
  if (res.error) throw new Error(`creative_lab_audio_files: ${res.error.message}`);
}
