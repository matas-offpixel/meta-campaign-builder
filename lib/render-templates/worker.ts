/**
 * lib/render-templates/worker.ts — renders a package's files on Remotion
 * Lambda, one tick at a time (/api/cron/creative-lab-render-tick, every
 * minute), and files each one as it finishes.
 *
 * Per file: the composition's inputs (signed clip and track URLs, the text
 * layers), one Lambda render (eu-west-2, H.264 CRF 18, yuv420p, AAC 192),
 * the mp4 into Storage, the mp4 into the event's tree ({stage} / {owner} /
 * Videos, the filing stages Lab renders use), the 8 checks and the Montage
 * list on the file, then the row. A No text version from artist material
 * only also gets a shortcut in the artist library's Renders and an
 * artist_assets row. A file whose render fails is "Didn't render"; one
 * whose Drive copy fails stays done with drive_status failed (the Lab's
 * existing retry), and its checks still run.
 *
 * In flight: at most MAX_LAB_RENDERS_AT_ONCE across caption renders and
 * package files (one Lambda budget). Every write is a service-role write
 * from the cron; nothing here calls Meta.
 *
 * Relative imports only (node:test).
 */

import type { CompositionRender } from "../creative-lab/lambda.ts";
import type { Probe } from "../creative-lab/mp4-probe.ts";
import { APP_ID_KEY, APP_TAG_KEY, type DriveApi } from "../drive/client.ts";
import type { DriveDb, RowOf } from "../drive/db.ts";
import { emptyLog, ensureRouteFolder } from "../drive/folders.ts";
import { labArtistFolderName } from "../drive/owner.ts";
import { promoterOwner, routeRender, type DriveOwner } from "../drive/tree.ts";
import { MONTAGE_SETTINGS, runMontageChecks } from "./checks.ts";
import { parseRenderFileName, type MontageVariant, type Ratio } from "./file-name.ts";
import { loadPackageState, type Db, type LoadDeps } from "./load.ts";
import { cutSheetText, MONTAGE, type MontagePlan } from "./montage-plan.ts";
import { montageText } from "./start.ts";
import { settlePackages } from "./store.ts";
import type { CheckKey } from "./words.ts";

export const PACKAGE_BUCKET = "campaign-assets";
export const PACKAGE_FILE_TAG = "m4_render";
export const CUT_SHEET_TAG = "m4_cut_sheet";
export const LIBRARY_RENDER_TAG = "m4_library_render";

type Row = Record<string, unknown>;

export type WorkerDeps = LoadDeps & {
  signUrl(bucket: string, path: string): Promise<string>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  download(bucket: string, path: string): Promise<Uint8Array>;
  render(req: CompositionRender): Promise<{ bytes: Uint8Array; renderMs: number }>;
  probe(bytes: Uint8Array): Probe;
  /** The variant's text blocks as master PNGs in Storage (layers.ts), signed. */
  layers(input: { packageId: string; eventId: string; clientId: string; variant: MontageVariant; plan: MontagePlan }): Promise<{ url: string; fromFrame: number; toFrame: number }[]>;
  /** The kit's logo is the one stored for the event now (latest art). */
  latestArt(eventId: string): Promise<boolean>;
  drive: DriveApi | null;
  /** The library's Renders folder for an artist, or null when the library is off (artist-library/library-drive.ts). */
  libraryRenders(artist: { id: string; name: string }): Promise<string | null>;
  now(): Date;
  today: string;
};

export type TickResult = { claimed: number; done: number; failed: number; settled: number; busy: boolean };

function shortError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/https?:\/\/\S+/g, "").trim().slice(0, 300);
}

async function one(db: Db, table: string, id: string): Promise<Row | null> {
  if (!id) return null;
  const res = await db.from(table).select("*").eq("id", id).maybeSingle();
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data as Row | null) ?? null;
}

/** The Drive owner folder for the package: the client for promoter footage, else the lead artist's folder. */
async function driveOwnerFor(db: Db, pkg: Row, plan: MontagePlan, ownerKind: string, client: Row, event: Row): Promise<DriveOwner | null> {
  const lineupRes = await db.from("event_artists").select("artist_id, source").eq("event_id", String(event.id));
  const lineupIds = ((lineupRes.data ?? []) as Row[]).filter((r) => r.source === "lab").map((r) => String(r.artist_id));
  const libraryNames = lineupIds.length ? (((await db.from("artists").select("name").in("id", lineupIds)).data ?? []) as Row[]).map((r) => String(r.name)) : [];
  if (ownerKind === "promoter") return promoterOwner(String(client.name), libraryNames);
  const firstClip = plan.segments[0]?.clipId;
  const clip = firstClip ? await one(db, "creative_lab_clips", firstClip) : null;
  const lab = clip ? await one(db, "creative_lab_artists", String(clip.artist_id)) : null;
  if (!lab) return null;
  void pkg;
  return { kind: "artist", artistId: String(lab.id), name: await labArtistFolderName(db as never, lab as never) };
}

async function sourceUrl(db: Db, deps: WorkerDeps, clipId: string): Promise<{ url: string; cropFocusX: number; cropFocusY: number }> {
  const clip = await one(db, "creative_lab_clips", clipId);
  if (!clip) throw new Error("a picked clip is gone");
  const asset = await one(db, "creative_assets", String(clip.render_asset_id || clip.creative_asset_id || ""));
  if (!asset?.storage_path) throw new Error("a picked clip has no file");
  return {
    url: await deps.signUrl(String(asset.storage_bucket || PACKAGE_BUCKET), String(asset.storage_path)),
    cropFocusX: clip.crop_focus_x == null ? 0.5 : Number(clip.crop_focus_x),
    cropFocusY: clip.crop_focus_y == null ? 0.5 : Number(clip.crop_focus_y),
  };
}

/** Render, store, file and check one package file. Never throws: a failure is the row's. */
export async function renderPackageFile(db: Db, deps: WorkerDeps, row: Row): Promise<"done" | "failed"> {
  const id = String(row.id);
  try {
    const pkg = await one(db, "creative_lab_render_packages", String(row.package_id));
    if (!pkg) throw new Error("package gone");
    const plan = pkg.plan as MontagePlan;
    const picks = pkg.picks as { clipIds: string[]; trackId: string; voice: "promoter" | "artist" };
    const event = await one(db, "events", String(pkg.event_id));
    const client = event ? await one(db, "clients", String(event.client_id)) : null;
    if (!event || !client) throw new Error("event gone");
    const variant = String(row.variant) as MontageVariant;
    const ratio = String(row.aspect) as Ratio;
    const fileName = String(row.file_name);

    const segments = [];
    for (const s of plan.segments) {
      const src = await sourceUrl(db, deps, s.clipId);
      segments.push({ url: src.url, fromFrame: s.fromFrame, frames: s.frames, startFromS: s.sourceStartS, cropFocusX: src.cropFocusX, cropFocusY: src.cropFocusY });
    }
    const track = await one(db, "creative_lab_audio_files", picks.trackId);
    if (!track?.storage_path) throw new Error("the track has no file");
    const audioUrl = await deps.signUrl(PACKAGE_BUCKET, String(track.storage_path));
    const layers = variant === "no-text" ? [] : await deps.layers({ packageId: String(pkg.id), eventId: String(event.id), clientId: String(event.client_id), variant, plan });
    const rendered = await deps.render({
      composition: "Montage",
      inputProps: { ratio, fps: MONTAGE.fps, durationInFrames: MONTAGE.fps * MONTAGE.durationS, segments, audioUrl, audioStartS: plan.window.startS, flashes: plan.flashes, layers },
      muted: false,
      frameCount: MONTAGE.fps * MONTAGE.durationS,
      crf: MONTAGE_SETTINGS.crf ?? undefined,
      pixelFormat: "yuv420p",
      audioBitrate: MONTAGE_SETTINGS.audioBitrate,
    });
    const storagePath = `renders/m4/${String(pkg.id)}/${fileName}`;
    await deps.upload(PACKAGE_BUCKET, storagePath, rendered.bytes, "video/mp4");
    let probe: Probe | null = null;
    try {
      probe = deps.probe(rendered.bytes);
    } catch {
      probe = null;
    }

    // The checks, with the facts read again now.
    const loaded = await loadPackageState(db, String(event.id), deps, deps.now(), deps.today);
    const parsed = parseRenderFileName(fileName);
    const packageVariants = (((await db.from("creative_lab_renders").select("variant, aspect").eq("package_id", String(pkg.id))).data ?? []) as Row[])
      .filter((r) => String(r.aspect) === ratio)
      .map((r) => String(r.variant));
    const textNow = loaded ? montageText(loaded, undefined) : null;
    const textThen = plan.texts.announcement.length ? plan.texts : null;
    const hook = textThen?.announcement.find((b) => b.kind === "hook")?.lines[0] ?? "";
    const details = plan.texts.teaser.find((b) => b.kind === "details")?.lines ?? ["", ""];
    const close = plan.texts.teaser.find((b) => b.kind === "close")?.lines ?? [];
    const names = plan.texts.announcement.filter((b) => b.kind === "name").map((b) => b.lines[0] ?? "");
    const clipRows = plan.segments.map((s) => s.clipId);
    const clipMeta = (((await db.from("creative_lab_clips").select("id, in_s, out_s, owner").in("id", clipRows)).data ?? []) as Row[]).map((c) => ({
      id: String(c.id),
      name: String(c.id),
      owner: (c.owner === "promoter" ? "promoter" : "artist") as "artist" | "promoter",
      isHeadliner: false,
      inS: Number(c.in_s ?? 0),
      outS: c.out_s == null ? Number.POSITIVE_INFINITY : Number(c.out_s),
    }));
    const checks = parsed
      ? runMontageChecks({
          name: parsed,
          fileName,
          probe,
          settings: MONTAGE_SETTINGS,
          plan,
          clips: clipMeta,
          text: { hook, date: details[0] ?? "", venue: details[1] ?? "", lineup: names, cta: close },
          factsNow: textNow
            ? { date: textNow.date, venue: textNow.venue, lineup: textNow.lineup.slice(0, names.length), cta: textNow.cta }
            : { date: "", venue: "", lineup: [], cta: [] },
          claimStage: String(pkg.stage),
          stageNow: loaded?.facts.stage ?? String(pkg.stage),
          track: { id: String(track.id), flagged: Boolean(track.rights_flag), durationS: track.duration_s == null ? null : Number(track.duration_s) },
          copy: { voice: picks.voice, approvedCaption: true },
          ownerNeeded: clipMeta.some((c) => c.owner === "promoter") ? "promoter" : "offpixel",
          packageVariants,
          latestArt: variant === "no-text" ? true : await deps.latestArt(String(event.id)),
        })
      : { passed: false, failed: ["cta_naming_art"] as CheckKey[], notes: ["the file name isn't the 25 Nov convention"] };

    const filed = await fileOnDrive(db, deps, { row, pkg, event, client, plan, bytes: rendered.bytes, passed: checks.passed, storagePath });
    const { driveFileId, driveError, shortcutId } = filed;

    const update = await db
      .from("creative_lab_renders")
      .update({
        status: "done",
        error: null,
        storage_path: storagePath,
        render_ms: rendered.renderMs,
        checks,
        drive_status: driveFileId ? "copied" : "failed",
        drive_file_id: driveFileId,
        drive_file_name: driveFileId ? fileName : null,
        drive_error: driveError,
        drive_copied_at: driveFileId ? deps.now().toISOString() : null,
        drive_render_attempt: Number(row.attempt ?? 1),
        library_shortcut_id: shortcutId,
      })
      .eq("id", id);
    if (update.error) throw new Error(`creative_lab_renders: ${update.error.message}`);
    return "done";
  } catch (err) {
    await db.from("creative_lab_renders").update({ status: "failed", error: shortError(err) }).eq("id", id);
    return "failed";
  }
}

type Filed = { driveFileId: string | null; driveError: string | null; shortcutId: string | null };

/**
 * Drive: {stage} / {owner} / Videos, the file under its own name; the cut
 * sheet once per package; and, for a shareable file that passed every check,
 * the library's Renders shortcut and its artist_assets row (AL1). Never
 * throws: a failure is the row's drive_error.
 */
async function fileOnDrive(
  db: Db,
  deps: WorkerDeps,
  input: { row: Row; pkg: Row; event: Row; client: Row; plan: MontagePlan; bytes: Uint8Array; passed: boolean; storagePath: string },
): Promise<Filed> {
  const { row, pkg, event, client, plan } = input;
  const id = String(row.id);
  const fileName = String(row.file_name);
  if (!deps.drive || !event.drive_folder_id) return { driveFileId: null, driveError: deps.drive ? "no event folder" : "drive off", shortcutId: null };
  let driveFileId: string | null = null;
  let shortcutId: string | null = null;
  try {
    const owner = await driveOwnerFor(db, pkg, plan, String(row.owner_kind), client, event);
    if (!owner) throw new Error("no owner folder");
    const route = routeRender({ stage: String(pkg.stage) === "signup" ? "signup" : "on-sale", today: deps.today, eventDate: event.event_date == null ? null : String(event.event_date), owner, kind: "video" });
    const folderId = await ensureRouteFolder(db as unknown as DriveDb, deps.drive, event as RowOf<"events">, client as RowOf<"clients">, route, emptyLog());
    const file = await deps.drive.uploadFile({ parentId: folderId, name: fileName, mimeType: "video/mp4", bytes: input.bytes, appProperties: { [APP_TAG_KEY]: PACKAGE_FILE_TAG, [APP_ID_KEY]: id } });
    driveFileId = file.id;
    const fresh = await one(db, "creative_lab_render_packages", String(pkg.id));
    if (!fresh?.cut_sheet_drive_file_id) {
      const sheet = (["no-text", "teaser", "announcement"] as const).map((v) => cutSheetText(plan.sheet, v)).join("\n");
      const sheetName = `${fileName.split("__").slice(0, 3).join("__")}__cut-sheet__r${String(row.round_no)}.txt`;
      const sheetFile = await deps.drive.uploadFile({ parentId: folderId, name: sheetName, mimeType: "text/plain", bytes: new TextEncoder().encode(sheet), appProperties: { [APP_TAG_KEY]: CUT_SHEET_TAG, [APP_ID_KEY]: String(pkg.id) } });
      await db.from("creative_lab_render_packages").update({ cut_sheet_drive_file_id: sheetFile.id }).eq("id", String(pkg.id)).is("cut_sheet_drive_file_id", null);
    }
    // AL1: only a shareable file (No text, artist material only) that passed every check joins the library's Renders.
    if (row.rights_shareable === true && input.passed && owner.kind === "artist") {
      const lab = await one(db, "creative_lab_artists", owner.artistId);
      const libraryId = lab?.artist_id ? String(lab.artist_id) : null;
      const renders = libraryId ? await deps.libraryRenders({ id: libraryId, name: owner.name }) : null;
      if (libraryId && renders) {
        const sc = await deps.drive.createShortcut({ parentId: renders, name: fileName, targetId: file.id, appProperties: { [APP_TAG_KEY]: LIBRARY_RENDER_TAG, [APP_ID_KEY]: id } });
        shortcutId = sc.id;
        await db.from("artist_assets").upsert(
          {
            artist_id: libraryId,
            asset_key: `m4_render:${id}`,
            kind: "render",
            name: fileName,
            drive_file_id: file.id,
            storage_path: input.storagePath,
            source_event_id: String(event.id),
            source_client_id: String(event.client_id),
            owner_kind: "offpixel",
            shareable: true,
            held_reason: null,
            lab_render_id: id,
            matched_by: "lab",
            material_at: deps.now().toISOString(),
          },
          { onConflict: "artist_id,asset_key" },
        );
      }
    }
    return { driveFileId, driveError: null, shortcutId };
  } catch (err) {
    return { driveFileId, driveError: shortError(err), shortcutId };
  }
}

/**
 * "Copy to Drive" (m4.row.copy_again): a file that rendered but whose Drive
 * copy didn't finish is filed again from its Storage copy. Nothing renders.
 * Only the owner's done, unfiled files.
 */
export async function copyToDriveAgain(db: Db, deps: WorkerDeps, input: { renderId: string; userId: string }): Promise<boolean> {
  const row = await one(db, "creative_lab_renders", input.renderId);
  if (!row || String(row.user_id) !== input.userId || row.recipe == null || row.status !== "done" || row.drive_file_id || !row.storage_path) return false;
  const pkg = await one(db, "creative_lab_render_packages", String(row.package_id));
  const event = pkg ? await one(db, "events", String(pkg.event_id)) : null;
  const client = event ? await one(db, "clients", String(event.client_id)) : null;
  if (!pkg || !event || !client) return false;
  const bytes = await deps.download(PACKAGE_BUCKET, String(row.storage_path));
  const passed = (row.checks as { passed?: boolean } | null)?.passed === true;
  const filed = await fileOnDrive(db, deps, { row, pkg, event, client, plan: pkg.plan as MontagePlan, bytes, passed, storagePath: String(row.storage_path) });
  const update = await db
    .from("creative_lab_renders")
    .update({
      drive_status: filed.driveFileId ? "copied" : "failed",
      drive_file_id: filed.driveFileId,
      drive_file_name: filed.driveFileId ? String(row.file_name) : null,
      drive_error: filed.driveError,
      drive_copied_at: filed.driveFileId ? deps.now().toISOString() : null,
      library_shortcut_id: filed.shortcutId,
    })
    .eq("id", input.renderId);
  if (update.error) throw new Error(`creative_lab_renders: ${update.error.message}`);
  return Boolean(filed.driveFileId);
}

/** One tick: claim queued package files into the free Lambda slots, render them side by side, settle packages. */
export async function runPackageTick(db: Db, deps: WorkerDeps, opts: { maxAtOnce: number }): Promise<TickResult> {
  const rendering = await db.from("creative_lab_renders").select("id", { count: "exact", head: true }).eq("status", "rendering");
  if (rendering.error) throw new Error(`creative_lab_renders: ${rendering.error.message}`);
  const slots = Math.max(0, opts.maxAtOnce - (rendering.count ?? 0));
  if (slots === 0) return { claimed: 0, done: 0, failed: 0, settled: (await settlePackages(db, deps.now())).length, busy: true };
  const queued = await db.from("creative_lab_renders").select("*").eq("status", "queued").not("recipe", "is", null).order("created_at", { ascending: true }).limit(slots);
  if (queued.error) throw new Error(`creative_lab_renders: ${queued.error.message}`);
  const claimed: Row[] = [];
  for (const row of (queued.data ?? []) as Row[]) {
    const claim = await db.from("creative_lab_renders").update({ status: "rendering" }).eq("id", String(row.id)).eq("status", "queued").select("id");
    if (claim.error) throw new Error(`creative_lab_renders: ${claim.error.message}`);
    if ((claim.data ?? []).length) claimed.push(row);
  }
  const results = await Promise.all(claimed.map((row) => renderPackageFile(db, deps, row)));
  const settled = await settlePackages(db, deps.now());
  return { claimed: claimed.length, done: results.filter((r) => r === "done").length, failed: results.filter((r) => r === "failed").length, settled: settled.length, busy: false };
}
