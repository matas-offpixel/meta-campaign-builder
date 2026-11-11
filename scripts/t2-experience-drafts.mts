/**
 * H85 / H88 drafts: T2 on the photo ground (overlay templates issues 11–13)
 * for Matas to judge. Drafts go to --out and nowhere else: no Drive or
 * Storage write, no approval, no export, no launch, and every draft is
 * stamped while its experience line or claim is held.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/t2-experience-drafts.mts \
 *     --event P26-BDAY --kit <the STORY PSD's kit folder> --out <drafts folder> \
 *     --experience "SOUTHAMPTON'S BIGGEST HOUSE  PARTY" [--spaces keep|one] \
 *     [--photo-drive "<file name in 02 Source / Venue & crowd>"] [--photo-asset <creative_assets id>] \
 *     [--clip <clip id>[@<in s>]] … [--seconds 8] [--lambda]
 *
 * Footage (O76), read only: only the promoter's own. A clip must have
 * creative_lab_clips.owner = 'promoter'. A photo is read from the event's
 * Drive folder 02 Source / Venue & crowd (the pickup imports video only, so
 * photos live there), downloaded into the work folder and never stored.
 * With no promoter clip and no photo, nothing is rendered (exit 3).
 *
 * A clip's in-point: `@<s>` draws the draft from that second, inside the
 * clip's stored window, and changes no row. The window is at least 4.75 s so
 * the claim fits (O37). The clip renders from its 1080 render copy when it
 * has one (render_asset_id, #1176 / #1181), else the original.
 *
 * Stills render locally (sharp). Clips render on Lambda (--lambda) through
 * T1OnClip: the three bands and the top layer from frame 0, the claim layer
 * at 1.5 s (O83). The site is a temporary one with no kit font, removed in
 * every exit path; each S3 render is deleted after download. On Lambda the
 * kit face is fetched per run from the private kit-fonts bucket (O52).
 *
 * Two versions (Matas, 10 Nov): v1 with no claim, v2 the live roll-call,
 * stamped while held. The typed experience line is kept verbatim; the
 * writer's word bans are Suggest's only.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { bundle } from "@remotion/bundler";
import { deleteRender, deleteSite, deploySite, getFunctions, getOrCreateBucket, getRenderProgress, renderMediaOnLambda } from "@remotion/lambda";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { lowContrastShare, trimToInk, type Rect } from "../lib/creative-lab/artist-card.ts";
import { redLineVerdict } from "../lib/creative-lab/artist-card-claim.ts";
import { type WarningRow } from "../lib/creative-lab/claim-approval.ts";
import { draftVersions, releaseFromRow, type DraftVersion } from "../lib/creative-lab/draft-versions.ts";
import { driveFromEnv } from "../lib/drive/client.ts";
import { DOUBLE_SPACE, doubleSpaceRun, photoT2Stamp, saveExperienceLine } from "../lib/creative-lab/experience-line.ts";
import { detectFaces } from "../lib/creative-lab/face-detect.ts";
import { providedFace } from "../lib/creative-lab/kit-faces.ts";
import { fontsDir, indexFonts, readFontFaces, requireFont } from "../lib/creative-lab/kit-font.ts";
import { REMOTION_REGION, lambdaChunking, pickLambdaFunction, readConcurrencyLimit } from "../lib/creative-lab/lambda.ts";
import { applyBacking } from "../lib/creative-lab/red-backing.ts";
import { withKitFace } from "../lib/creative-lab/t1-lambda.ts";
import { FORMAT_SIZE, footageWindow, claimOn } from "../lib/creative-lab/t1-video-frame.ts";
import { RED_BACKING, T1V_FACE, chooseBacking, distinctCrops, nearestRank, releaseNamesOf, type RedVerdict } from "../lib/creative-lab/t1-video.ts";
import {
  bandWord,
  videoBandChecks,
  T2P_DATA_NOTE,
  T2P_INVENTED,
  choosePhotoBandSteps,
  clipTooSmall,
  dataNoteChecks,
  dataNoteWord,
  judgeClipFaces,
  photoBandAnchors,
  photoClipSafe,
  photoClipTiming,
  photoDetails,
  photoGroundAllowed,
  planPhotoLayout,
  renderPhotoBands,
  type BandSteps,
  type PhotoFormat,
  type PhotoLayout,
  type PhotoSlotsInput,
  type SlotShares,
} from "../lib/creative-lab/t2-photo.ts";
import { photoBackingFor, photoRedLine, photoTypeLayers, renderPhotoStill, type PhotoStillResult } from "../lib/creative-lab/t2-photo-render.ts";
import { withMeasure } from "../lib/creative-lab/t2-render.ts";
import { blueNoise } from "../lib/creative-lab/video-bands.ts";
import type { T1OnClipProps } from "../src/remotion/compositions/T1OnClip.tsx";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const many = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]!] : []));
// Set once the draft site is deployed, cleared once it's deleted; every exit while it's set removes it first.
let siteLeft: { bucketName: string } | null = null;
const DRAFT_SITE = "creative-lab-t2-drafts";
const cleanup = async () => {
  if (!siteLeft) return;
  const s = siteLeft;
  siteLeft = null;
  await deleteSite({ bucketName: s.bucketName, region: REMOTION_REGION, siteName: DRAFT_SITE }).catch((e) => console.error(`deleteSite failed — remove ${DRAFT_SITE} by hand: ${(e as Error).message}`));
};
// A crash (a network error mid-render, 11 Nov) must still remove the site.
for (const ev of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(ev, (err) => {
    console.error(`${ev}: ${(err as Error)?.message ?? err}`);
    void cleanup().finally(() => process.exit(1));
  });
}
/** Transient network errors (EADDRNOTAVAIL, ECONNRESET, timeouts) are retried, three more times. */
async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (attempt >= 3 || !/EADDRNOTAVAIL|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|fetch failed|network|timeout|TooManyRequests|Rate Exceeded/i.test(msg)) throw e;
      console.error(`${what}: ${msg.slice(0, 120)} — retrying (${attempt + 1} of 3)`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}
const fail = async (m: string, code = 2): Promise<never> => {
  console.error(m);
  await cleanup();
  process.exit(code);
};
const code = flag("--event") ?? "";
const kitDir = flag("--kit") ?? "";
const outDir = resolve(flag("--out") ?? "");
const typed = flag("--experience") ?? "";
const seconds = Number(flag("--seconds") ?? "8");
const onLambda = argv.includes("--lambda");
if (!code || !kitDir || !flag("--out") || !typed) await fail("--event, --kit, --out and --experience are required");
if (argv.includes("--apply") || argv.includes("--export") || argv.includes("--approve")) await fail("this script never files, approves or exports: drafts go to --out only");
if (!(seconds >= 4.75)) await fail("--seconds must be at least 4.75 (O37: the claim needs 1.5 s + 0.25 s + 3 s)");

// O88: a run of two spaces is asked about once on save. For the drafts the answer is --spaces keep|one (default keep).
const spaces = (flag("--spaces") ?? "keep") as "keep" | "one";
const saved = saveExperienceLine(typed, { answer: spaces });
if (saved.status === "refused") await fail(saved.line);
const experience = saved.status === "saved" ? saved.text : "";
const askedSpaces = doubleSpaceRun(typed);

const COMP = resolve("node_modules/@remotion/compositor-darwin-arm64");
const ff = (bin: "ffmpeg" | "ffprobe", args: string[]) => {
  const r = spawnSync(join(COMP, bin), args, { env: { ...process.env, DYLD_LIBRARY_PATH: COMP }, encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${bin}: ${r.stderr.slice(-400)}`);
  return r.stdout;
};

// ─── Live reads, select only ───────────────────────────────────────────────
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const ev = await db.from("events").select("id, name, client_id, event_date, venue_name").eq("event_code", code).maybeSingle();
if (ev.error || !ev.data) await fail(`No event ${code}: ${ev.error?.message ?? "not found"}`);
const event = ev.data!;

// O76: the promoter's own clips only; `id@in` sets the draft's in-point.
const clipArgs = many("--clip").map((a) => {
  const [id, at] = a.split("@");
  return { id: id!, inS: at != null ? Number(at) : null };
});
const clipRows: Record<string, unknown>[] = [];
for (const c of clipArgs) {
  const r = await db.from("creative_lab_clips").select("*").eq("id", c.id).maybeSingle();
  if (r.error || !r.data) await fail(`clip ${c.id}: not found`);
  const allowed = photoGroundAllowed({ owner: (r.data!.owner as "promoter" | "artist" | null) ?? null });
  if (!allowed.ok) await fail(`clip ${c.id}: ${allowed.line}`);
  if (r.data!.shown_on_event_id !== event.id && r.data!.event_id !== event.id) await fail(`clip ${c.id} isn't ${code}'s footage`);
  clipRows.push(r.data as Record<string, unknown>);
}
const photoDrive = flag("--photo-drive");
const photoAsset = flag("--photo-asset");
if (!photoDrive && !photoAsset && !clipArgs.length) {
  const promo = await db.from("creative_lab_clips").select("id").eq("owner", "promoter").eq("shown_on_event_id", event.id).range(0, 199);
  await fail(`Nothing rendered: no --clip or photo given. ${code} has ${(promo.data ?? []).length} promoter clips; pick from them with --clip.`, 3);
}

const tw = await db.from("ticket_warnings").select("id, claim, format, state, approved_by, approved_at, runs_from, runs_to, updated_at").eq("event_id", event.id).range(0, 999);
if (tw.error) await fail(`ticket_warnings: ${tw.error.message}`);
const rows = (tw.data ?? []) as (WarningRow & { updated_at: string })[];
const er = await db.from("event_releases").select("*").eq("event_id", event.id).order("position").range(0, 99);
if (er.error) await fail(`event_releases: ${er.error.message}`);
const tiers = (er.data ?? []) as Record<string, unknown>[];
const releaseNames = releaseNamesOf(tiers as { name: string; position: number }[]);
let versions: DraftVersion[] = [];
try {
  versions = draftVersions(tiers.map(releaseFromRow), rows);
} catch (e) {
  await fail((e as Error).message);
}
const facts = await db.from("creative_lab_event_facts").select("*").eq("event_id", event.id).maybeSingle();
const lineup = ((facts.data?.lineup as string[] | null) ?? []).filter(Boolean);
// O79: "& MORE" only when the facts say more acts are coming. No such field is on the facts yet, so it is never drawn.
const moreToAnnounce = facts.data?.more_to_announce === true;

// ─── Kit (read in place) ────────────────────────────────────────────────────
const pieces = JSON.parse(readFileSync(join(kitDir, "pieces.json"), "utf8")) as { pieces: { role: string; label: string; file: string }[] };
const logoRec = pieces.pieces.find((p) => p.role === "logo");
if (!logoRec) await fail("the kit has no logo piece");
const logo = await trimToInk(readFileSync(join(kitDir, logoRec!.file)));
const info = pieces.pieces.filter((p) => p.role === "info").map((p) => p.label);
const live = [info.find((l) => /DAY\b/i.test(l)), info.find((l) => l.includes(">") && !/\dPM/i.test(l))].filter((l): l is string => !!l);
const details = photoDetails({ liveLayer: live.length === 2 ? live : null, date: (event.event_date as string | null) ?? null, venue: (event.venue_name as string | null) ?? null });

// The face: read in place locally, or (on --lambda) fetched per run from the private bucket and name-checked (O52).
let faceTmp: { file: string; done: () => void } | null = null;
if (onLambda) {
  const kf = providedFace(String(event.client_id ?? ""), "BootzyCondensedTM-Regular");
  if (!kf) await fail("Bootzy is not a provided face of this client's kit (O51)");
  let release: () => void = () => {};
  const hold = new Promise<void>((r) => (release = r));
  const ready = new Promise<string>((resolveFile, reject) => {
    withKitFace(
      { postscriptName: kf!.postscriptName, path: kf!.storage.path },
      {
        signUrl: async (bucket, path, ttl) => (await db.storage.from(bucket).createSignedUrl(path, ttl)).data?.signedUrl ?? null,
        fetchBytes: async (url) => {
          const r = await fetch(url);
          return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
        },
      },
      async (file) => {
        resolveFile(file);
        await hold;
      },
    ).catch(reject);
  });
  faceTmp = { file: await ready, done: release };
}
const face = requireFont("BootzyCondensedTM-Regular", onLambda ? indexFonts(dirname(faceTmp!.file)) : indexFonts(fontsDir()));

mkdirSync(outDir, { recursive: true });
const work = join(outDir, "_work");
mkdirSync(work, { recursive: true });
const slotsFor = (v: DraftVersion): PhotoSlotsInput => ({ experience, claim: v.claim, releaseNames, lineup, moreToAnnounce, details, logo: { ink: { width: logo.width, height: logo.height }, kind: "lockup" } });
const stampFor = (v: DraftVersion) => photoT2Stamp("held", v.claim ? (v.watermark ? "held" : "approved") : null);
const pc = (v: number | null | undefined) => (v == null ? "–" : `${(v * 100).toFixed(1)} %`);
const claimWidthNote = (L: PhotoLayout | undefined) => {
  const c = L?.block.lines.find((l) => l.role === "claim" && l.color === "white");
  // O91: logged against the example's claim, never judged.
  return c ? `${Math.round(c.widthPx)} px at ${Math.round(c.capPx)} px cap (example ${T2P_DATA_NOTE.claim.right - T2P_DATA_NOTE.claim.left} px at 54)` : "– (no claim)";
};

type Row = { ground: string; source: string; inS: string; fmt: PhotoFormat; version: string; note: string; band: string; claimWidth: string; faces: string; steps: string; backing: string; result: string; file: string | null; renderedOn: string };
const table: Row[] = [];
const sheet: { label: string; frames: string[] }[] = [];
const lambdaCosts: { id: string; functions: number; costUsd: number | null }[] = [];
const notes: string[] = [];

// ─── The photo ground: stills ──────────────────────────────────────────────
if (photoDrive || photoAsset) {
  let photo: Buffer;
  let photoLabel: string;
  if (photoDrive) {
    const folder = await db.from("drive_folders").select("drive_folder_id").eq("event_id", event.id).eq("key", "02/venue-crowd").maybeSingle();
    if (!folder.data) await fail("the event has no 02 Source / Venue & crowd folder");
    const { drive, reason } = driveFromEnv();
    if (!drive) await fail(`Drive: ${reason}`);
    const found = (await drive!.listChildren(String(folder.data!.drive_folder_id))).find((f) => f.name === photoDrive);
    if (!found) await fail(`no "${photoDrive}" in 02 Source / Venue & crowd`);
    photo = Buffer.from(await drive!.download(found!.id));
    writeFileSync(join(work, "photo.jpg"), photo);
    photoLabel = `Drive · 02 Source / Venue & crowd · ${photoDrive}`;
  } else {
    const asset = await db.from("creative_assets").select("id, storage_path").eq("id", photoAsset!).maybeSingle();
    if (asset.error || !asset.data) await fail(`photo asset ${photoAsset}: not found`);
    const file = await db.storage.from("campaign-assets").download(String(asset.data!.storage_path));
    if (file.error || !file.data) await fail(`download ${photoAsset}`);
    photo = Buffer.from(await file.data!.arrayBuffer());
    photoLabel = `creative_assets ${photoAsset}`;
  }
  const faces = (await detectFaces(photo!, { minConfidence: 0.3 })).map((f) => ({ left: f.x, top: f.y, width: f.width, height: f.height }));
  for (const v of versions) {
    const stamp = stampFor(v);
    const r: PhotoStillResult = await renderPhotoStill({ photo: photo!, slots: slotsFor(v), face, logoPng: logo.png, stamp, faces, cropFocusY: [0.5, 0.4, 0.6, 0.3, 0.7] });
    const frames: string[] = [];
    for (const fmt of ["9:16", "4:5", "1:1"] as PhotoFormat[]) {
      const name = `photo_${v.id}_${fmt.replace(":", "x")}_DRAFT${r.report.refused[fmt] ? "_REFUSED" : ""}.png`;
      if (r.images[fmt]) {
        writeFileSync(join(outDir, name), r.images[fmt]!);
        frames.push(join(outDir, name));
      }
      const s = r.report.steps;
      const L = r.report.layouts[fmt];
      table.push({
        ground: "photo",
        source: photoLabel!,
        inS: "–",
        fmt,
        version: v.id,
        note: L ? dataNoteWord(dataNoteChecks(L)) : "–",
        band: "– (a still: O96 is for video)",
        claimWidth: claimWidthNote(L),
        faces: `${r.report.crop != null ? `chosen y ${r.report.crop} x ${r.report.cropX} · ` : ""}${r.report.tried.join("; ") || "–"}`,
        steps: s ? `+${s.top * 10} / +${s.centre * 10} / +${s.bottom * 10}` : "–",
        backing: r.report.red ? `${pc(r.report.red.share)} → ${r.report.red.verdict.white ? "white" : r.report.red.verdict.backing != null ? `red, backed ${Math.round(r.report.red.verdict.backing * 100)} %` : "red"}` : "–",
        result: r.held ?? (r.report.refused[fmt] ? `refused (flagged preview): ${r.report.refused[fmt]}` : `passes, "${stamp}"`),
        file: r.images[fmt] ? name : null,
        renderedOn: "local",
      });
    }
    sheet.push({ label: `photo · ${v.id} (9:16 · 4:5 · 1:1)`, frames });
  }
}

// ─── The photo ground: clips ───────────────────────────────────────────────
if (clipRows.length) {
  let lambda: { serveUrl: string; bucketName: string; functionName: string; limit: number } | null = null;
  if (onLambda) {
    console.log("bundling the composition…");
    await bundle({ entryPoint: resolve("src/remotion/index.tsx"), outDir: join(work, "bundle") });
    // The site must carry no kit font (O52): only the app's own TikTok Sans.
    const bundled = (function walk(d: string): string[] {
      return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    })(join(work, "bundle"))
      .filter((f) => /\.(otf|ttf|ttc|woff2?)$/i.test(f))
      .filter((f) => {
        const faces = readFontFaces(new Uint8Array(readFileSync(f)));
        return !faces.length || !faces.every((x) => /^TikTok Sans/i.test(x.family ?? ""));
      });
    if (bundled.length) await fail(`the Remotion bundle carries a font other than TikTok Sans: ${bundled.join(", ")}`);
    const { bucketName } = await getOrCreateBucket({ region: REMOTION_REGION });
    const fn = pickLambdaFunction(await getFunctions({ region: REMOTION_REGION, compatibleOnly: true }));
    if (!fn) await fail("no 480 s Remotion function in eu-west-2");
    const site = await deploySite({ entryPoint: resolve("src/remotion/index.tsx"), bucketName, region: REMOTION_REGION, siteName: DRAFT_SITE });
    siteLeft = { bucketName };
    lambda = { serveUrl: site.serveUrl, bucketName, functionName: fn!.functionName, limit: await readConcurrencyLimit() };
    console.log(`site ${DRAFT_SITE} deployed (no kit font in it); function ${fn!.functionName}`);
  } else {
    await fail("clip drafts render on Lambda: pass --lambda");
  }
  const noise = blueNoise(32);
  const dither = (x: number, y: number) => noise[(y % 32) * 32 + (x % 32)]!;
  const dataUri = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

  for (const [ci, clip] of clipRows.entries()) {
    const wantIn = clipArgs[ci]!.inS;
    // #1176 / #1181: the 1080 render copy when there is one, else the original.
    const assetId = String(clip.render_asset_id || clip.creative_asset_id);
    const asset = await db.from("creative_assets").select("id, storage_path, filename").eq("id", assetId).maybeSingle();
    if (asset.error || !asset.data) await fail(`asset ${assetId} for clip ${clip.id}`);
    const label = String((await db.from("creative_assets").select("filename").eq("id", String(clip.creative_asset_id)).maybeSingle()).data?.filename ?? clip.id);
    const slug = label.replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const clipFile = join(work, `${slug}.mp4`);
    if (!existsSync(clipFile)) {
      const file = await db.storage.from("campaign-assets").download(String(asset.data!.storage_path));
      if (file.error || !file.data) await fail(`download clip ${clip.id}`);
      writeFileSync(clipFile, Buffer.from(await file.data!.arrayBuffer()));
    }
    const probe = JSON.parse(ff("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", clipFile])) as { streams: { width: number; height: number; r_frame_rate: string }[]; format: { duration: string } };
    const src = { width: probe.streams[0]!.width, height: probe.streams[0]!.height };
    const [fn0, fd0] = probe.streams[0]!.r_frame_rate.split("/").map(Number);
    const fps = Math.round((fn0! / (fd0 || 1)) * 100) / 100;
    const fileS = Number(probe.format.duration);
    const storedIn = clip.in_s == null ? 0 : Number(clip.in_s);
    const storedOut = clip.out_s == null ? fileS : Math.min(fileS, Number(clip.out_s));
    const inS = wantIn ?? storedIn;
    if (inS < storedIn - 1e-6 || inS + seconds > storedOut + 1e-6) await fail(`${label}: in-point ${inS} s + ${seconds} s is outside its stored window ${storedIn}–${storedOut} s (this script changes no row)`);
    const dur = Math.min(seconds, storedOut - inS);
    const timing = photoClipTiming(dur, true);
    // O82: faces on 5-a-second samples of the draft's window, at the source's size.
    const sdir = join(work, `${slug}-${inS}`);
    mkdirSync(sdir, { recursive: true });
    if (!existsSync(join(sdir, "s0001.png"))) ff("ffmpeg", ["-y", "-v", "error", "-ss", String(inS), "-t", String(dur), "-i", clipFile, "-r", String(T1V_FACE.fps), join(sdir, "s%04d.png")]);
    const frames = readdirSync(sdir).filter((f) => f.endsWith(".png")).sort();
    const times = frames.map((_, i) => i / T1V_FACE.fps);
    const faceCache = join(sdir, "faces.json");
    let sourceFaces: Rect[][] = existsSync(faceCache) ? (JSON.parse(readFileSync(faceCache, "utf8")) as Rect[][]) : [];
    if (sourceFaces.length !== frames.length) {
      sourceFaces = [];
      for (const f of frames) sourceFaces.push((await detectFaces(readFileSync(join(sdir, f)), { minConfidence: 0.3 })).map((b) => ({ left: b.x, top: b.y, width: b.width, height: b.height })));
      writeFileSync(faceCache, JSON.stringify(sourceFaces));
    }
    console.log(`${label}: ${src.width}×${src.height} from ${clip.render_asset_id ? "its render copy" : "the original"}, draft ${inS}–${inS + dur} s (stored window ${storedIn}–${storedOut.toFixed(1)} s), ${frames.length} samples`);

    for (const v of versions) {
      const stamp = stampFor(v);
      // O95 (issue 15): video is one 9:16. No 4:5 or 1:1 clip draft is made.
      for (const fmt of ["9:16"] as PhotoFormat[]) {
        const size = FORMAT_SIZE[fmt];
        const id = `clip-${slug}_${v.id}_${fmt.replace(":", "x")}`;
        const small = clipTooSmall(src, fmt);
        const row: Row = { ground: "clip", source: label, inS: `${inS} s (stored ${storedIn}–${storedOut.toFixed(1)} s, unchanged)`, fmt, version: v.id, note: "–", band: "–", claimWidth: "–", faces: "–", steps: "–", backing: "–", result: "", file: null, renderedOn: "Lambda" };
        if (small) {
          table.push({ ...row, result: small });
          continue;
        }
        const planned = await withMeasure(face, (m) => planPhotoLayout({ ...slotsFor(v), claim: timing.claim ? v.claim : null }, "clip", fmt, m));
        if (!planned.ok) {
          table.push({ ...row, result: planned.line });
          continue;
        }
        const L = planned.layout;
        row.note = dataNoteWord(dataNoteChecks(L));
        // O96 / O100: every type box in the band; the red line's backing core is checked with the type (its feather isn't).
        const core = photoBackingFor(L);
        row.band = bandWord(videoBandChecks(L, core ? [{ slot: "backing core", box: core.rect }] : []));
        row.inS += ` · lineup top ${Math.round(L.lineup[0]!.capTop)}${L.lineupShift ? ` (moved up ${Math.round(L.lineupShift)} px, O94)` : ""} · block step ${L.block.step} (${[0.056, 0.0485, 0.042][L.block.step]} H)`;
        row.claimWidth = claimWidthNote(L);
        if (fmt === "9:16" && !photoClipSafe(L).ok) notes.push(`${id}: a type box is outside the safe area`);
        // O82 + O81: at each distinct crop, faces first, then the band ladder on the p95 of the samples.
        const cands = distinctCrops(src, fmt, [0.5, 0.4, 0.6, 0.3, 0.7]);
        const cache = new Map<string, { data: Buffer; channels: number }>();
        const groundAt = async (cy: number, i: number) => {
          const key = `${cy}:${i}`;
          if (!cache.has(key)) {
            const win = footageWindow(src, fmt, cy);
            const g = await sharp(join(sdir, frames[i]!)).extract({ left: Math.round(win.left), top: Math.round(win.top), width: Math.round(win.width), height: Math.round(win.height) }).resize(size.width, size.height).removeAlpha().raw().toBuffer({ resolveWithObject: true });
            cache.set(key, { data: g.data, channels: g.info.channels });
          }
          return cache.get(key)!;
        };
        const anchors = photoBandAnchors(L);
        const bandsAlpha = (steps: BandSteps) => renderPhotoBands(size, anchors, steps);
        const over = (g: { data: Buffer; channels: number }, band: Uint8Array) => {
          const out = Buffer.from(g.data);
          for (let p = 0, i = 0; p < size.width * size.height; p += 1, i += g.channels) {
            const a = band[p * 4 + 3]! / 255;
            if (a > 0) for (let c = 0; c < 3; c += 1) out[i + c] = Math.round(out[i + c]! * (1 - a));
          }
          return out;
        };
        const tried: string[] = [];
        let chosen: { cy: number; steps: BandSteps; faceLine: string } | null = null;
        let refused: string | null = null;
        for (const cy of cands) {
          const win = footageWindow(src, fmt, cy);
          const k = size.width / win.width;
          const samples = times.map((tS, i) => ({ tS, faces: (sourceFaces[i] ?? []).map((b) => ({ left: (b.left - win.left) * k, top: (b.top - win.top) * k, width: b.width * k, height: b.height * k })) }));
          const fv = judgeClipFaces(samples, L);
          const faceLine = `top ${pc(fv.topShare)} / claim ${pc(fv.claimShare)} · run ${fv.longestRunS.toFixed(1)} s`;
          if (!fv.ok) {
            tried.push(`crop ${cy}: ${faceLine} → ${fv.line}`);
            refused ??= fv.line;
            continue;
          }
          for (let i = 0; i < frames.length; i += 1) await groundAt(cy, i);
          const ladder = choosePhotoBandSteps((steps) => {
            const band = bandsAlpha(steps);
            const per: SlotShares[] = [];
            for (let i = 0; i < frames.length; i += 1) {
              const g = cache.get(`${cy}:${i}`)!;
              const data = over(g, band);
              const b = L.boxes;
              const pad = (r: Rect) => ({ left: r.left - 12, top: r.top - 12, width: r.width + 24, height: r.height + 24 });
              per.push({ lineup: lowContrastShare(data, size.width, g.channels, pad(b.lineup)), block: lowContrastShare(data, size.width, g.channels, b.block), details: lowContrastShare(data, size.width, g.channels, pad(b.details)), logo: lowContrastShare(data, size.width, g.channels, b.logo) });
            }
            return { lineup: nearestRank(per.map((x) => x.lineup), 95), block: nearestRank(per.map((x) => x.block), 95), details: nearestRank(per.map((x) => x.details), 95), logo: nearestRank(per.map((x) => x.logo), 95) };
          });
          if (!ladder.ok) {
            tried.push(`crop ${cy}: ${faceLine} → ${ladder.line}`);
            refused = ladder.line;
            continue;
          }
          tried.push(`crop ${cy}: ${faceLine} → passes`);
          chosen = { cy, steps: ladder.steps, faceLine };
          break;
        }
        if (!chosen && !refused) refused = "no crop tried";
        const cy = chosen?.cy ?? cands[0]!;
        const steps = chosen?.steps ?? { top: 0, centre: 0, bottom: 0 };
        // O58: the red line's backing, on the samples where the claim is on.
        let red: RedVerdict | null = null;
        let redShare: number | null = null;
        const redLine = photoRedLine(L);
        if (redLine) {
          const box = photoBackingFor(L)!;
          const band = bandsAlpha(steps);
          const byStep: number[][] = [[], ...RED_BACKING.steps.map(() => [])];
          for (let i = 0; i < frames.length; i += 1) {
            if (!claimOn(times[i]!)) continue;
            const g = await groundAt(cy, i);
            const data = over(g, band);
            byStep[0]!.push(redLineVerdict(data, size.width, g.channels, redLine, size).share);
            for (const [bi, op] of RED_BACKING.steps.entries()) byStep[bi + 1]!.push(redLineVerdict(applyBacking(data, size.width, size.height, g.channels, box, op), size.width, g.channels, redLine, size).share);
          }
          const p95 = byStep.map((v) => nearestRank(v, 95));
          red = chooseBacking(p95, "clip");
          redShare = red.backing != null ? p95[RED_BACKING.steps.indexOf(red.backing as 0.4 | 0.6 | 0.8) + 1]! : p95[0]!;
        }
        row.faces = tried.join("; ");
        row.steps = `+${steps.top * 10} / +${steps.centre * 10} / +${steps.bottom * 10}`;
        row.backing = red ? `${pc(redShare)} → ${red.white ? "white" : red.backing != null ? `red, backed ${Math.round(red.backing * 100)} %` : "red"}` : "–";
        // The layers (O83): bands and the top layer from frame 0, the claim layer at 1.5 s.
        const bandsPng = await sharp(Buffer.from(renderPhotoBands(size, anchors, steps, { dither })), { raw: { width: size.width, height: size.height, channels: 4 } }).png().toBuffer();
        const layers = await photoTypeLayers(L, { face, logoPng: logo.png, red, stamp });
        const signed = (await db.storage.from("campaign-assets").createSignedUrl(String(asset.data!.storage_path), 3600)).data?.signedUrl;
        if (!signed) await fail(`sign ${label}`);
        const props: T1OnClipProps = { clipUrl: signed!, format: fmt, sourceWidth: src.width, sourceHeight: src.height, cropFocusY: cy, cropFocusX: 0.5, inS, fps, durationInSeconds: dur, muted: true, bandsUrl: dataUri(bandsPng), topUrl: dataUri(layers.top), claimUrl: layers.claim ? dataUri(layers.claim) : null };
        const out = join(outDir, `${id}_DRAFT${chosen ? "" : "_REFUSED"}.mp4`);
        if (existsSync(out)) {
          console.log(`${id}: already rendered, reused (${out.split("/").pop()})`);
          table.push({ ...row, result: chosen ? `passes, "${stamp}"` : `refused: ${refused}`, file: out.split("/").pop()!, renderedOn: "Lambda (an earlier run)" });
          const shots: string[] = [];
          for (const t of [0, 1.75, Math.min(4.75, dur - 0.1)]) {
            const f = join(work, `${id}_${t}.png`);
            ff("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1", f]);
            shots.push(f);
          }
          sheet.push({ label: `${label} @ ${inS} s · ${v.id} · ${fmt}${chosen ? "" : " · REFUSED"}`, frames: shots });
          continue;
        }
        const nFrames = Math.round(dur * fps);
        const chunk = lambdaChunking(lambda!.limit, nFrames);
        const r = await withRetry("renderMediaOnLambda", () => renderMediaOnLambda({ region: REMOTION_REGION, functionName: lambda!.functionName, serveUrl: lambda!.serveUrl, composition: "T1OnClip", inputProps: props as unknown as Record<string, unknown>, codec: "h264", crf: 18, muted: true, framesPerLambda: chunk.framesPerLambda, concurrencyPerLambda: chunk.concurrencyPerLambda, privacy: "private", downloadBehavior: { type: "download", fileName: null } }));
        const progressOf = () => withRetry("getRenderProgress", () => getRenderProgress({ renderId: r.renderId, bucketName: r.bucketName, functionName: lambda!.functionName, region: REMOTION_REGION }));
        let progress = await progressOf();
        while (!progress.done && !progress.fatalErrorEncountered) {
          await new Promise((res) => setTimeout(res, 2000));
          progress = await progressOf();
        }
        if (progress.fatalErrorEncountered || !progress.outKey) {
          await withRetry("deleteRender", () => deleteRender({ bucketName: r.bucketName, region: REMOTION_REGION, renderId: r.renderId }));
          table.push({ ...row, result: `Lambda render failed (render deleted): ${progress.errors.map((e) => e.message.split("\n")[0]).join("; ").slice(0, 200)}` });
          continue;
        }
        const { GetObjectCommand } = await import("@aws-sdk/client-s3");
        const { LambdaClientInternals } = await import("@remotion/lambda/client");
        const s3 = LambdaClientInternals.getS3Client({ region: REMOTION_REGION, customCredentials: null, forcePathStyle: false, requestHandler: null });
        const bytes = await withRetry("download the render", async () => {
          const obj = await s3.send(new GetObjectCommand({ Bucket: r.bucketName, Key: progress.outKey! }));
          return Buffer.from(await obj.Body!.transformToByteArray());
        });
        writeFileSync(out, bytes);
        await withRetry("deleteRender", () => deleteRender({ bucketName: r.bucketName, region: REMOTION_REGION, renderId: r.renderId }));
        const functions = Math.ceil(nFrames / (chunk.framesPerLambda ?? nFrames)) + 1;
        lambdaCosts.push({ id, functions, costUsd: progress.costs?.accruedSoFar ?? null });
        console.log(`${id}: crop ${cy} · ${chosen ? "passes" : `REFUSED: ${refused}`} · bands ${row.steps} · red ${row.backing} · ${functions} functions · $${(progress.costs?.accruedSoFar ?? 0).toFixed(4)}`);
        table.push({ ...row, result: chosen ? `passes, "${stamp}"` : `refused: ${refused}`, file: out.split("/").pop()! });
        // Contact sheet: frames at 0, 1.75 and 4.75 s.
        const shots: string[] = [];
        for (const t of [0, 1.75, Math.min(4.75, dur - 0.1)]) {
          const f = join(work, `${id}_${t}.png`);
          ff("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1", f]);
          shots.push(f);
        }
        sheet.push({ label: `${label} @ ${inS} s · ${v.id} · ${fmt}${chosen ? "" : " · REFUSED"}`, frames: shots });
      }
    }
  }
  await cleanup();
}
faceTmp?.done();

// ─── The report ────────────────────────────────────────────────────────────
const L: string[] = [];
L.push(`# T2 on the photo ground · ${code} · ${event.name} · ${new Date().toISOString().slice(0, 16)}Z`, "");
L.push(`Experience line (typed by Matas, kept verbatim; the writer's bans apply only to Suggest): "${experience}". Not approved: every draft is stamped.${askedSpaces ? ` O88 asked "${DOUBLE_SPACE.ask(askedSpaces.word)}" — answered ${spaces === "keep" ? DOUBLE_SPACE.keep : DOUBLE_SPACE.makeOne} (--spaces).` : ""}`);
L.push(`Versions: ${versions.map((v) => `${v.id}${v.claim ? ` "${v.claim.replace("\n", " / ")}"` : ""}${v.watermark ? " (held)" : ""}`).join("; ")}.`);
L.push(`Lineup (creative_lab_event_facts): ${lineup.join(" · ")} · "& MORE": ${moreToAnnounce ? "drawn (the facts say more acts are coming)" : "not drawn (the facts have no flag)"}. Details: ${details.join(" / ")}. Logo: the kit's event lockup (0.25 W).`);
L.push("In-points are drawn in the draft only, inside each clip's stored window; no row is changed (the Lab has no in/out write path).", "");
L.push("Video is one 9:16 (O95, issue 15): the clip drafts are 9:16 only; the photo stills keep 9:16, 4:5 and 1:1. The band check (O96 / O100) reads every type box of a 9:16 clip against x 120–960, first ink ≥ 353, last baseline 1238.", "");
L.push("| Ground | Footage · in-point | Format | Version | Slot check (H86, ±0.005 H / W) | Band check (O96 / O100) | Claim width (O91, logged) | Faces (O82): crops tried | Band steps top / centre / bottom (O81) | Red line → backing (O58) | Result | Rendered | File |");
L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of table) L.push(`| ${r.ground} | ${r.source} · ${r.inS} | ${r.fmt} | ${r.version} | ${r.note} | ${r.band} | ${r.claimWidth} | ${r.faces} | ${r.steps} | ${r.backing} | ${r.result} | ${r.renderedOn} | ${r.file ?? "–"} |`);
if (lambdaCosts.length) {
  const total = lambdaCosts.reduce((a, c) => a + (c.costUsd ?? 0), 0);
  L.push("", `Lambda: ${lambdaCosts.length} renders, ${lambdaCosts[0]!.functions} functions each (one orchestrator plus the chunks), $${(total / lambdaCosts.length).toFixed(4)} a render on average, $${total.toFixed(4)} in all. Site ${DRAFT_SITE} (no kit font) removed; each S3 render deleted after download.`);
}
for (const n of notes) L.push(`- ${n}`);
L.push("", "## Invented (T2P_INVENTED)");
for (const i of T2P_INVENTED) L.push(`- **${i.ruling}**: ${i.value}`);
writeFileSync(join(outDir, "report.md"), L.join("\n") + "\n");

// Contact sheet: one row per draft.
if (sheet.length) {
  const rowsPng: Buffer[] = [];
  for (const s of sheet) {
    const tiles = await Promise.all(s.frames.map((f) => sharp(f).resize(null, 420).png().toBuffer({ resolveWithObject: true })));
    const w = tiles.reduce((a, t) => a + t.info.width + 8, 8);
    const label = Buffer.from(`<svg width="${Math.max(w, 600)}" height="28"><text x="8" y="20" font-size="18" fill="#fff" font-family="Helvetica">${s.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`);
    let x = 8;
    const comp = tiles.map((t) => {
      const c = { input: t.data, left: x, top: 32 };
      x += t.info.width + 8;
      return c;
    });
    rowsPng.push(await sharp({ create: { width: Math.max(w, 600), height: 460, channels: 3, background: { r: 28, g: 28, b: 28 } } }).composite([{ input: label, left: 0, top: 0 }, ...comp]).png().toBuffer());
  }
  const W = Math.max(...(await Promise.all(rowsPng.map(async (r) => (await sharp(r).metadata()).width!))));
  const sheetPng = await sharp({ create: { width: W, height: rowsPng.length * 464, channels: 3, background: { r: 18, g: 18, b: 18 } } }).composite(rowsPng.map((r, i) => ({ input: r, left: 0, top: i * 464 }))).png().toBuffer();
  writeFileSync(join(outDir, "CONTACT-SHEET.png"), sheetPng);
}
console.log(`wrote ${table.filter((r) => r.file).length} drafts, CONTACT-SHEET.png and report.md to ${outDir}`);
