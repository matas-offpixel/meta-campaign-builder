/**
 * Files approved Lab renders into the event tree (S20, HS9) and marks judged
 * winners (S21, HS19).
 *
 * Approved = a render that is done (ready) and sits on an on cell of a
 * proposed round: creative_lab_round_ads.render_id. Generate's previews are
 * never renders, so they never reach here. Off the render path: the render
 * row stays done whatever happens here; launch reads Storage, never Drive.
 *
 * Never overwrites: a name already in the folder gets _v2, _v3 (S14). A
 * re-render (creative_lab_renders.attempt moved on since the last copy) is
 * filed again under the next free name.
 */

import { APP_ID_KEY, APP_TAG_KEY, SHORTCUT_MIME, type DriveApi } from "./client.ts";
import { ensureEventKey, type ClientRow, type DriveDb, type EventRow, emptyLog, type TreeLog } from "./folders.ts";
import { isArchivedClientStatus } from "../db/client-status.ts";
import {
  WINNERS_KEY,
  angleSlug,
  freeRenderFileName,
  isCancelled,
  renderStage,
  routeRender,
  winnerFileName,
  type CycleCalendar,
  type FolderKey,
} from "./tree.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows of tables migration 217 adds columns to, not in database.types.ts yet
type Row = Record<string, any>;

export const RENDER_BUCKET = "campaign-assets";
/** One try, then three retries with backoff (HS9). */
export const MAX_DRIVE_TRIES = 4;
export const BACKOFF_MINUTES = [2, 10, 30] as const;

export type StorageDownload = (bucket: string, path: string) => Promise<Uint8Array>;

export type FilingContext = {
  render: Row;
  roundNo: number;
  caption: Row;
  clip: Row;
  artist: Row;
  event: EventRow & Row;
  client: ClientRow & Row;
  asset: Row;
};

export type FilingPlan = {
  renderId: string;
  key: FolderKey;
  cycle: string | null;
  baseName: Parameters<typeof freeRenderFileName>[0];
  bucket: string;
  path: string;
  mimeType: string;
};

async function one(db: DriveDb, table: string, id: unknown): Promise<Row | null> {
  if (id == null || id === "") return null;
  const res = await db.from(table).select("*").eq("id", String(id)).maybeSingle();
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data as Row | null) ?? null;
}

async function many(db: DriveDb, table: string, column: string, value: unknown): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await db.from(table).select("*").eq(column, value).range(from, from + 999);
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
    const rows = (res.data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export type SkipReason =
  | "not_ready"
  | "not_in_a_round"
  | "no_caption"
  | "no_clip"
  | "no_artist"
  | "no_event"
  | "no_client"
  | "archived_client"
  | "cancelled"
  | "no_tree"
  | "no_file";

/** Everything a filing needs, or why this render is not filed (it then stays as it is). */
export async function loadFilingContext(db: DriveDb, render: Row): Promise<FilingContext | { skip: SkipReason }> {
  if (render.status !== "done") return { skip: "not_ready" };
  const ads = await many(db, "creative_lab_round_ads", "render_id", render.id);
  if (!ads.length) return { skip: "not_in_a_round" };
  const rounds = (await Promise.all([...new Set(ads.map((ad) => String(ad.round_id)))].map((id) => one(db, "creative_lab_rounds", id)))).filter(
    (row): row is Row => Boolean(row),
  );
  if (!rounds.length) return { skip: "not_in_a_round" };
  const roundNo = Math.min(...rounds.map((round) => Number(round.round_no) || 1));
  const caption = await one(db, "creative_lab_captions", render.caption_id);
  if (!caption) return { skip: "no_caption" };
  const clip = await one(db, "creative_lab_clips", render.clip_id);
  if (!clip) return { skip: "no_clip" };
  const artist = await one(db, "creative_lab_artists", clip.artist_id);
  if (!artist) return { skip: "no_artist" };
  const event = (await one(db, "events", caption.event_id ?? rounds[0].event_id)) as (EventRow & Row) | null;
  if (!event) return { skip: "no_event" };
  const client = (await one(db, "clients", event.client_id)) as (ClientRow & Row) | null;
  if (!client) return { skip: "no_client" };
  if (isArchivedClientStatus(client.status)) return { skip: "archived_client" };
  if (isCancelled(event.status)) return { skip: "cancelled" };
  if (!event.drive_folder_id) return { skip: "no_tree" };
  const asset = await one(db, "creative_assets", render.creative_asset_id);
  if (!asset?.storage_path) return { skip: "no_file" };
  return { render, roundNo, caption, clip, artist, event, client, asset };
}

function extensionOf(path: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match ? match[1].toLowerCase() : "mp4";
}

function mimeFor(ext: string): string {
  if (ext === "mp4") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

export function planFiling(ctx: FilingContext, today: string, calendar?: CycleCalendar): FilingPlan {
  const stage = renderStage(ctx.event.status);
  const angle = angleSlug(String(ctx.caption.style), ctx.caption.mode);
  const route = routeRender({ stage, angle, today, eventDate: ctx.event.event_date ?? null, calendar });
  const path = String(ctx.asset.storage_path);
  const ext = extensionOf(path);
  return {
    renderId: String(ctx.render.id),
    key: route.key,
    cycle: route.cycle,
    baseName: {
      eventCode: ctx.event.event_code ?? null,
      artistName: String(ctx.artist.name),
      clipNo: Number(ctx.clip.clip_no),
      angle,
      captionNo: Number(ctx.caption.caption_no),
      stage,
      roundNo: ctx.roundNo,
      aspect: String(ctx.render.aspect || "9:16"),
      extension: ext,
    },
    bucket: String(ctx.asset.storage_bucket || RENDER_BUCKET),
    path,
    mimeType: mimeFor(ext),
  };
}

/** Renders the tick should try now: approved and not yet copied, a due retry, or a re-render since the copy. */
export function wantsFiling(render: Row, now: Date): boolean {
  if (render.status !== "done") return false;
  const status = render.drive_status ?? null;
  if (status === null) return true;
  if (status === "pending") return !render.drive_next_attempt_at || String(render.drive_next_attempt_at) <= now.toISOString();
  if (status === "copied") return render.drive_render_attempt != null && Number(render.attempt ?? 1) > Number(render.drive_render_attempt);
  return false;
}

export type FileResult =
  | { ok: true; renderId: string; folderKey: FolderKey; fileName: string; fileId: string }
  | { ok: false; renderId: string; skipped: SkipReason }
  | { ok: false; renderId: string; error: string; status: "pending" | "failed" };

function shortError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/https?:\/\/\S+/g, "").trim().slice(0, 300);
}

/**
 * File one render. A skip (not approved, no tree, archived client, cancelled
 * event) writes nothing. A failure counts a try; after MAX_DRIVE_TRIES the
 * row is failed with drive_error. The render's own status is never touched.
 */
export async function fileRender(
  db: DriveDb,
  drive: DriveApi,
  render: Row,
  deps: { download: StorageDownload; now: Date; today: string; calendar?: CycleCalendar; log?: TreeLog },
): Promise<FileResult> {
  const renderId = String(render.id);
  const ctx = await loadFilingContext(db, render);
  if ("skip" in ctx) return { ok: false, renderId, skipped: ctx.skip };
  const attempts = Number(render.drive_attempts ?? 0);
  if (render.drive_status !== "pending") {
    const res = await db.from("creative_lab_renders").update({ drive_status: "pending" }).eq("id", renderId);
    if (res.error) throw new Error(`creative_lab_renders: ${res.error.message}`);
  }
  try {
    const plan = planFiling(ctx, deps.today, deps.calendar);
    const folderId = await ensureEventKey(db, drive, ctx.event, ctx.client, plan.key, deps.log ?? emptyLog());
    const taken = new Set((await drive.listChildren(folderId)).map((file) => file.name));
    const name = freeRenderFileName(plan.baseName, taken);
    const bytes = await deps.download(plan.bucket, plan.path);
    const file = await drive.uploadFile({
      parentId: folderId,
      name,
      mimeType: plan.mimeType,
      bytes,
      appProperties: { [APP_TAG_KEY]: "lab_render", [APP_ID_KEY]: renderId },
    });
    const update = await db
      .from("creative_lab_renders")
      .update({
        drive_status: "copied",
        drive_file_id: file.id,
        drive_file_name: name,
        drive_error: null,
        drive_copied_at: deps.now.toISOString(),
        drive_attempts: 0,
        drive_next_attempt_at: null,
        drive_render_attempt: Number(render.attempt ?? 1),
        // A new copy is not the winner's file: a later judging marks it again.
        drive_winner_shortcut_id: null,
      })
      .eq("id", renderId);
    if (update.error) throw new Error(`creative_lab_renders: ${update.error.message}`);
    return { ok: true, renderId, folderKey: plan.key, fileName: name, fileId: file.id };
  } catch (err) {
    const tries = attempts + 1;
    const failed = tries >= MAX_DRIVE_TRIES;
    const message = shortError(err);
    const backoff = BACKOFF_MINUTES[Math.min(tries - 1, BACKOFF_MINUTES.length - 1)];
    const res = await db
      .from("creative_lab_renders")
      .update({
        drive_status: failed ? "failed" : "pending",
        drive_error: message,
        drive_attempts: tries,
        drive_next_attempt_at: failed ? null : new Date(deps.now.getTime() + backoff * 60_000).toISOString(),
      })
      .eq("id", renderId);
    if (res.error) throw new Error(`creative_lab_renders: ${res.error.message}`);
    return { ok: false, renderId, error: message, status: failed ? "failed" : "pending" };
  }
}

/**
 * "Drive copy failed — retry" (rule 7): back to pending with a fresh count,
 * picked up by the next tick. Only the owner's failed rows.
 */
export async function retryDriveCopy(db: DriveDb, args: { renderId: string; userId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await db.from("creative_lab_renders").select("*").eq("id", args.renderId).eq("user_id", args.userId).maybeSingle();
  if (res.error) throw new Error(`creative_lab_renders: ${res.error.message}`);
  const row = res.data as Row | null;
  if (!row) return { ok: false, error: "No render with that id." };
  if (row.drive_status !== "failed") return { ok: false, error: "This render's Drive copy has not failed." };
  const update = await db
    .from("creative_lab_renders")
    .update({ drive_status: "pending", drive_error: null, drive_attempts: 0, drive_next_attempt_at: null })
    .eq("id", args.renderId)
    .eq("user_id", args.userId);
  if (update.error) throw new Error(`creative_lab_renders: ${update.error.message}`);
  return { ok: true };
}

// ─── Winners (S21, HS19) ─────────────────────────────────────────────────────

export type WinnerResult = { renderId: string; fileName: string; shortcutId: string };

/**
 * For each winning ad of a judged round whose render is in Drive: the file
 * gains _winner and a shortcut lands in {event}/_Winners. The file stays
 * where it was filed. Idempotent: a renamed file is not renamed twice, and a
 * shortcut already pointing at the file is reused.
 */
export async function markWinners(db: DriveDb, drive: DriveApi, round: Row, log: TreeLog = emptyLog()): Promise<WinnerResult[]> {
  if (round.status !== "judged") return [];
  const ads = (await many(db, "creative_lab_round_ads", "round_id", round.id)).filter((ad) => ad.verdict === "winner" && ad.render_id);
  const out: WinnerResult[] = [];
  for (const ad of ads) {
    const render = await one(db, "creative_lab_renders", ad.render_id);
    if (!render || render.drive_status !== "copied" || !render.drive_file_id || render.drive_winner_shortcut_id) continue;
    const event = (await one(db, "events", round.event_id)) as (EventRow & Row) | null;
    const client = event ? ((await one(db, "clients", event.client_id)) as (ClientRow & Row) | null) : null;
    if (!event || !client || isArchivedClientStatus(client.status) || isCancelled(event.status) || !event.drive_folder_id) continue;
    const name = winnerFileName(String(render.drive_file_name ?? ""));
    if (name !== render.drive_file_name) await drive.update(String(render.drive_file_id), { name });
    const winners = await ensureEventKey(db, drive, event, client, WINNERS_KEY, log);
    const existing = (await drive.listChildren(winners)).find((file) => file.mimeType === SHORTCUT_MIME && file.shortcutTargetId === render.drive_file_id);
    const shortcut =
      existing ??
      (await drive.createShortcut({
        parentId: winners,
        name,
        targetId: String(render.drive_file_id),
        appProperties: { [APP_TAG_KEY]: "lab_winner_shortcut", [APP_ID_KEY]: String(render.id) },
      }));
    const update = await db
      .from("creative_lab_renders")
      .update({ drive_file_name: name, drive_winner_shortcut_id: shortcut.id })
      .eq("id", render.id);
    if (update.error) throw new Error(`creative_lab_renders: ${update.error.message}`);
    out.push({ renderId: String(render.id), fileName: name, shortcutId: shortcut.id });
  }
  return out;
}
