/**
 * Draft T1 clips (overlay templates issue 6, H36–H46) for Matas to judge.
 * Local only: Remotion renders on this machine, the kit face is read in place
 * from FONTS_DIR (never copied or committed), the clips are read from Storage
 * and nothing is written anywhere but --out. No Lambda, no Drive, no
 * approvals, no exports: every card carries a draft stamp. The type reaches
 * the composition as images, so the browser never loads the kit face.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/t1-video-drafts.mts \
 *     --event P26-BDAY --kit <the static PSD's kit folder> --out .scratch/drafts/t1-video-2026-11-10 \
 *     --clip '<clip id>' [--clip …] [--seconds 8] [--lambda] [--local-from 2160] [--version v2-roll-call] [--format 9:16]
 *
 * --lambda (issue 7, O52/O53): the face comes from the private kit-fonts
 * bucket through a one-hour signed URL and its name is checked
 * (t1-lambda.ts withKitFace) instead of FONTS_DIR; the clip goes to Lambda
 * as a signed Storage URL and the type and bands as data URIs in the props,
 * so nothing is uploaded and no font reaches Lambda or its public site. The
 * site is deployed under its own name (never the production one) and
 * removed afterwards; each S3 render is deleted once downloaded.
 *
 * For each clip, the round's two versions (Matas, 10 Nov; draft-versions.ts):
 * v1, no CTA (lockup, name, date); v2, the selling-fast roll-call from the
 * event's live tiers, stamped by its ticket_warnings row. At 9:16, 4:5 and
 * 1:1 (O62 skips a 4:5 or 1:1 under 1080 px wide). The face (O56) and
 * contrast (O57) are judged on 5-a-second samples, at each crop A then B.
 * Also renders a flat mid-grey test clip through the same composition and
 * checks O46's row steps on the encoded file.
 */

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";

import { bundle } from "@remotion/bundler";
import { deleteRender, deleteSite, deploySite, getFunctions, getOrCreateBucket, getRenderProgress, renderMediaOnLambda } from "@remotion/lambda";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { KIT_SHADOW, lowContrastShare, textOverlay, trimToInk, type Piece, type Placement, type Rect } from "../lib/creative-lab/artist-card.ts";
import { redLineVerdict, watermarkLayer } from "../lib/creative-lab/artist-card-claim.ts";
import { assertExportable, type WarningRow } from "../lib/creative-lab/claim-approval.ts";
import { KIT_RED, KIT_WHITE, renderCardLine } from "../lib/creative-lab/claim-slot.ts";
import { detectFaces } from "../lib/creative-lab/face-detect.ts";
import { TOO_SMALL_FOR_916, tooSmallFor916 } from "../lib/creative-lab/import-quality.ts";
import { providedFace } from "../lib/creative-lab/kit-faces.ts";
import { REMOTION_REGION, lambdaChunking, pickLambdaFunction, readConcurrencyLimit } from "../lib/creative-lab/lambda.ts";
import { withKitFace } from "../lib/creative-lab/t1-lambda.ts";
import { fontsDir, indexFonts, readFontFaces, requireFont } from "../lib/creative-lab/kit-font.ts";
import {
  FORMAT_SIZE,
  RED_BACKING,
  T1C,
  T1V_CONTRAST,
  T1V_FACE,
  T1V_INVENTED,
  T1V_LINES,
  backingRect,
  chooseBacking,
  chooseStep,
  claimAllowed,
  claimOn,
  clipBands,
  footageWindow,
  formatTooSmall,
  insideVideoSafe,
  judgeFaceOverTime,
  nearestRank,
  planClipLayout,
  planVideoClaim,
  releaseNamesOf,
  sampleTimes,
  type BackingBox,
  upscaleFactor,
  type ClipLayout,
  type FaceSample,
  type FaceVerdict,
  type MeasureCap,
  type RedVerdict,
  type VideoClaimPlan,
  type VideoFormat,
  arrangementsTried,
  distinctCrops,
} from "../lib/creative-lab/t1-video.ts";
import { applyBacking, backingLayer, checkFeather, type FeatherCheck } from "../lib/creative-lab/red-backing.ts";
import { renderSourceAsset } from "../lib/creative-lab/render-source.ts";
import { emptyTriedHeadings, triedSection } from "../lib/creative-lab/draft-report.ts";
import { draftVersions, releaseFromRow, type DraftVersion } from "../lib/creative-lab/draft-versions.ts";
import { MAX_KNEE_STEP, MAX_ROW_STEP, renderVideoBands, rowMeanLuma } from "../lib/creative-lab/video-bands.ts";
import type { T1OnClipProps } from "../src/remotion/compositions/T1OnClip.tsx";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const many = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]!] : []));
// Set once the draft site is deployed, cleared once it's deleted: an exit with it still set prints how to remove it.
let siteLeft: string | null = null;
process.on("exit", () => {
  if (siteLeft) console.error(`the draft site ${siteLeft} is still deployed — remove it with deleteSite({ siteName: "${siteLeft}" }) before anything else`);
});
const fail = (m: string): never => {
  console.error(m);
  process.exit(2);
};
const code = flag("--event") ?? "";
const kitDir = flag("--kit") ?? "";
const outDir = resolve(flag("--out") ?? "");
const clipIds = many("--clip");
const seconds = Number(flag("--seconds") ?? "8");
if (!code || !kitDir || !flag("--out") || !clipIds.length) fail("--event, --kit, --out and --clip are required");
if (argv.some((a) => ["--apply", "--export", "--upload"].includes(a))) fail("this script renders drafts only: it never files, exports or uploads");
const onLambda = argv.includes("--lambda");
// --local-from W: on --lambda, a clip at least W px wide renders here instead. Lambda's Chrome runs out of
// disk fetching a 2160 × 3840 source (round 3, Luke 4), and its disk is an infra setting this script doesn't change.
const localFrom = Number(argv[argv.indexOf("--local-from") + 1] ?? NaN);
const DRAFT_SITE = "creative-lab-t1-drafts";
mkdirSync(outDir, { recursive: true });
const work = join(outDir, "_work");
mkdirSync(work, { recursive: true });

const COMP = resolve("node_modules/@remotion/compositor-darwin-arm64");
const ff = (bin: "ffmpeg" | "ffprobe", args: string[]) => {
  const r = spawnSync(join(COMP, bin), args, { env: { ...process.env, DYLD_LIBRARY_PATH: COMP }, encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")}: ${r.stderr.slice(-600)}`);
  return r.stdout;
};

// ─── Kit and claims (read only) ──────────────────────────────────────────────
type PieceRecord = { role: string; label: string; artist: string | null; file: string; cap_px: number };
const kit = JSON.parse(readFileSync(join(kitDir, "pieces.json"), "utf8")) as { pieces: PieceRecord[] };
const piece = async (r: PieceRecord): Promise<Piece> => {
  const t = await trimToInk(readFileSync(join(kitDir, r.file)));
  return { png: t.png, width: t.width, height: t.height, capPx: Math.min(r.cap_px, t.height), label: r.label };
};
// O54: the kit's date line, verbatim (the one info piece that names a day).
const dateRec = kit.pieces.find((p) => p.role === "info" && /DAY\b/i.test(p.label));
const datePiece = dateRec ? await piece(dateRec) : null;
const lockupRec = kit.pieces.find((p) => p.role === "logo");
const lockup = lockupRec ? await piece(lockupRec) : null;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const ev = await db.from("events").select("id, name").eq("event_code", code).maybeSingle();
if (ev.error || !ev.data) fail(`No event ${code}`);
const event = ev.data!;
const tw = await db.from("ticket_warnings").select("id, claim, format, state, approved_by, approved_at, runs_from, runs_to, updated_at").eq("event_id", event.id).range(0, 999);
if (tw.error) fail(`ticket_warnings: ${tw.error.message}`);
const rows = (tw.data ?? []) as (WarningRow & { updated_at: string })[];
// The round's two versions (Matas, 10 Nov): no CTA, and the selling-fast roll-call from the live tiers (O60, read only).
const er = await db.from("event_releases").select("*").eq("event_id", event.id).order("position").range(0, 99);
if (er.error) fail(`event_releases: ${er.error.message}`);
const tiers = (er.data ?? []) as Record<string, unknown>[];
const releaseNames = releaseNamesOf(tiers as { name: string; position: number }[]);
let versions: DraftVersion[] = [];
try {
  versions = draftVersions(tiers.map(releaseFromRow), rows);
} catch (e) {
  fail((e as Error).message);
}
const rollCall = versions.find((v) => v.id === "v2-roll-call")!;
// --version ID (repeatable): draw only those versions (round 4: v2-roll-call only).
const onlyVersions = many("--version");
if (onlyVersions.length) {
  const unknown = onlyVersions.filter((id) => !versions.some((v) => v.id === id));
  if (unknown.length) fail(`unknown --version ${unknown.join(", ")}; versions are ${versions.map((v) => v.id).join(", ")}`);
  versions = versions.filter((v) => onlyVersions.includes(v.id));
}

// The face: read in place locally, or (on --lambda) fetched per run from the private bucket and name-checked (O52).
let faceTmp: { file: string; done: () => void } | null = null;
if (onLambda) {
  const kf = providedFace(String((await db.from("events").select("client_id").eq("id", event.id).maybeSingle()).data?.client_id ?? ""), "BootzyCondensedTM-Regular");
  if (!kf) fail("Bootzy is not a provided face of this client's kit (O51)");
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
const fonts = onLambda ? indexFonts(dirname(faceTmp!.file)) : indexFonts(fontsDir());
const face = requireFont("BootzyCondensedTM-Regular", fonts);

// Real advance widths (H7): measured at a reference cap, scaled.
const widthCache = new Map<string, number>();
const REF = 100;
async function withWidths<T>(run: (m: MeasureCap) => T): Promise<T> {
  for (let pass = 0; pass < 8; pass += 1) {
    const missing = new Set<string>();
    const m: MeasureCap = (t, cap) => {
      const w = widthCache.get(t);
      if (w == null) {
        missing.add(t);
        return t.length * 0.35 * cap;
      }
      return (w * cap) / REF;
    };
    const out = run(m);
    if (!missing.size) return out;
    for (const t of missing) widthCache.set(t, (await renderCardLine(t, KIT_WHITE, REF, face)).width);
  }
  throw new Error("measuring did not settle");
}

// ─── A local file server for the composition ────────────────────────────────
const server = createServer((req, res) => {
  const p = join(work, decodeURIComponent((req.url ?? "/").split("?")[0]!.replace(/^\//, "")));
  if (!p.startsWith(work) || !existsSync(p)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  const body = readFileSync(p);
  const type = p.endsWith(".mp4") ? "video/mp4" : "image/png";
  const range = req.headers.range;
  if (range && type === "video/mp4") {
    const [a, b] = range.replace("bytes=", "").split("-");
    const start = Number(a);
    const end = b ? Number(b) : body.length - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${body.length}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    res.end(body.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": body.length, "Accept-Ranges": "bytes" });
  res.end(body);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
console.log("bundling the composition…");
const serveUrl = await bundle({ entryPoint: resolve("src/remotion/index.tsx"), outDir: join(work, "bundle") });
// The site must carry no kit font (O52): only the app's own TikTok Sans.
const bundled = (function walk(d: string): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
})(join(work, "bundle"))
  .filter((f) => /\.(otf|ttf|ttc|woff2?)$/i.test(f))
  // Bundled assets are renamed to hashes, so each font is identified by its own name table: only the app's TikTok Sans may be there.
  .filter((f) => {
    const faces = readFontFaces(new Uint8Array(readFileSync(f)));
    return !faces.length || !faces.every((x) => /^TikTok Sans/i.test(x.family ?? ""));
  });
if (bundled.length) fail(`the Remotion bundle carries a font other than TikTok Sans: ${bundled.join(", ")}`);
let lambda: { serveUrl: string; bucketName: string; functionName: string; limit: number } | null = null;
if (onLambda) {
  const { bucketName } = await getOrCreateBucket({ region: REMOTION_REGION });
  const fn = pickLambdaFunction(await getFunctions({ region: REMOTION_REGION, compatibleOnly: true }));
  if (!fn) fail("no 480 s Remotion function in eu-west-2");
  const site = await deploySite({ entryPoint: resolve("src/remotion/index.tsx"), bucketName, region: REMOTION_REGION, siteName: DRAFT_SITE });
  siteLeft = DRAFT_SITE;
  lambda = { serveUrl: site.serveUrl, bucketName, functionName: fn!.functionName, limit: await readConcurrencyLimit() };
  console.log(`site ${DRAFT_SITE} deployed (no kit font in it); function ${fn!.functionName}; concurrency ${lambda.limit}`);
}
const lambdaCosts: { id: string; functions: number; costUsd: number | null; ms: number }[] = [];
const lambdaFailed: { id: string; why: string }[] = [];
const dataUri = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

// ─── Layers ──────────────────────────────────────────────────────────────────
// --format F (repeatable): draw only those formats.
const onlyFormats = many("--format");
const FORMATS: VideoFormat[] = (["9:16", "4:5", "1:1"] as VideoFormat[]).filter((f) => !onlyFormats.length || onlyFormats.includes(f));
if (!FORMATS.length) fail(`--format must be 9:16, 4:5 or 1:1`);
const transparent = (fmt: VideoFormat) => sharp({ create: { ...FORMAT_SIZE[fmt], channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
const rgbaPng = (data: Uint8Array, size: { width: number; height: number }) => sharp(Buffer.from(data), { raw: { width: size.width, height: size.height, channels: 4 } }).png().toBuffer();
/** O55 + O57: a layout's bands at a band step, as a PNG at the format's size. */
const bandCache = new Map<string, Buffer>();
async function bandsFor(l: ClipLayout, step: { top: number; bottom: number }): Promise<Buffer> {
  const key = `${l.format}|${l.arrangement}|${l.claim.length}|${JSON.stringify(l.anchors)}|${step.top}|${step.bottom}`;
  const hit = bandCache.get(key);
  if (hit) return hit;
  const png = await rgbaPng(renderVideoBands(l.size.width, l.size.height, clipBands(l, step)), l.size);
  bandCache.set(key, png);
  return png;
}
/** The type in a layout is already at the format's size: one O6 shadow over the group. */
async function layer(pieces: Piece[], places: Placement[], fmt: VideoFormat): Promise<Buffer> {
  return textOverlay(pieces, places, FORMAT_SIZE[fmt], { k: 1, dx: 0, dy: 0 }, KIT_SHADOW);
}

// ─── Per clip ────────────────────────────────────────────────────────────────
const readFrom: string[] = [];
type Row = { clip: string; artist: string; claimLabel: string; fmt: VideoFormat; arrangement: string; crop: number | null; scale: number | null; tried: string[]; faceLine: string; topShare: number; claimShare: number; runS: number; topP95: number | null; lockupP95: number | null; bottomP95: number | null; steps: string; redP95: number | null; red: string; feather: FeatherCheck[]; claim: string; safe: boolean; file: string | null; result: string; renderedOn?: string };
const table: Row[] = [];
const contactRows: { label: string; file: string }[] = [];

for (const clipId of clipIds) {
  // select * so a render copy (O68, render-source.ts) is read when the import follow-up has added one. Read only.
  const c = await db.from("creative_lab_clips").select("*").eq("id", clipId).maybeSingle();
  if (c.error || !c.data) fail(`clip ${clipId}`);
  const clip = c.data!;
  const art = await db.from("creative_lab_artists").select("name").eq("id", clip.artist_id).maybeSingle();
  const artist = String(art.data?.name ?? "?");
  // O68 / migration 220: the clip's 1080 render copy (render_asset_id) when it has one, else the original (creative_asset_id).
  // `asset` is the row the render reads: every download, probe and Lambda signed URL below uses it.
  const source = renderSourceAsset(clip as { render_asset_id?: unknown; creative_asset_id?: unknown });
  const asset = await db.from("creative_assets").select("id, storage_path").eq("id", source.assetId).maybeSingle();
  if (asset.error || !asset.data) fail(`asset ${source.assetId} for ${clipId}`);
  readFrom.push(`${clipId.slice(0, 8)}: ${source.copy ? "the 1080 render copy" : "the original"} (creative_assets ${source.assetId.slice(0, 8)}, ${String(asset.data!.storage_path)})`);
  const file = await db.storage.from("campaign-assets").download(String(asset.data!.storage_path));
  if (file.error || !file.data) fail(`download ${clipId}`);
  const slug = `${artist.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${clip.clip_no}`;
  const clipFile = `${slug}.mp4`;
  writeFileSync(join(work, clipFile), Buffer.from(await file.data!.arrayBuffer()));
  const probe = JSON.parse(ff("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", join(work, clipFile)])) as { streams: { width: number; height: number; r_frame_rate: string }[]; format: { duration: string } };
  const src = { width: probe.streams[0]!.width, height: probe.streams[0]!.height };
  const inS = Number(clip.in_s ?? 0);
  const full = Number(clip.out_s ?? probe.format.duration) - inS;
  const dur = Math.min(seconds, full);
  const fps = 30;

  // 5-a-second samples of the source, once.
  const sdir = join(work, `${slug}-samples`);
  mkdirSync(sdir, { recursive: true });
  // The bundled ffmpeg has no fps filter: the output rate drops frames to 5 a second.
  if (!existsSync(join(sdir, "s0001.png"))) ff("ffmpeg", ["-y", "-v", "error", "-ss", String(inS), "-t", String(dur), "-i", join(work, clipFile), "-r", String(T1V_FACE.fps), join(sdir, "s%04d.png")]);
  const frames = readdirSync(sdir).filter((f) => f.endsWith(".png")).sort();
  const times = sampleTimes(dur).slice(0, frames.length);
  // Face boxes per sample, cached beside the samples (detection is the slow part).
  const faceCache = join(sdir, "faces.json");
  let sourceFaces: Rect[][] = existsSync(faceCache) ? (JSON.parse(readFileSync(faceCache, "utf8")) as Rect[][]) : [];
  if (sourceFaces.length !== frames.length) {
    sourceFaces = [];
    for (const f of frames) {
      const boxes = await detectFaces(readFileSync(join(sdir, f)), { minConfidence: 0.3 });
      sourceFaces.push(boxes.map((b) => ({ left: b.x, top: b.y, width: b.width, height: b.height })));
    }
    writeFileSync(faceCache, JSON.stringify(sourceFaces));
  }

  // O54: the clip carries the lockup, the name and one date line (the kit's, verbatim); no venue or time.
  const nameRec = kit.pieces.find((p) => p.role === "name" && p.artist === artist);
  if (!nameRec) fail(`no name piece for ${artist}`);
  const namePiece = await piece(nameRec!);
  if (!datePiece) fail("the kit has no date line");

  for (const job of versions.map((v) => ({ label: v.id, text: v.claim, wm: v.watermark, why: v.why }))) {
    const allowed = job.text ? claimAllowed(full) : ({ ok: true } as const);
    const plan = job.text && allowed.ok ? await withWidths((m) => planVideoClaim(job.text!, m, { releaseNames })) : null;
    const claimPlan = plan && !("held" in plan) ? (plan as VideoClaimPlan) : null;

    for (const fmt of FORMATS) {
      const size = FORMAT_SIZE[fmt];
      const id = `${slug}_${job.label}_${fmt.replace(":", "x")}`;
      // O62: no upscaling.
      const small = tooSmallFor916(src) ? TOO_SMALL_FOR_916 : formatTooSmall(src, fmt);
      if (small) {
        console.log(`${id}: ${small}`);
        table.push({ clip: clipId.slice(0, 8), artist, claimLabel: job.label, fmt, arrangement: "–", crop: null, scale: null, tried: [], faceLine: small, topShare: 0, claimShare: 0, runS: 0, topP95: null, lockupP95: null, bottomP95: null, steps: "–", redP95: null, red: "–", feather: [], claim: "–", safe: true, file: null, result: small });
        continue;
      }
      const cropX = Number(clip.crop_focus_x ?? 0.5);
      const own = Number(clip.crop_focus_y ?? 0.5);
      // O73: candidates that give the same window are tried once.
      const cands = distinctCrops(src, fmt, [...new Set([own, 0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8].map((v) => Math.round(v * 100) / 100))], cropX);
      const samplesFor = (cy: number): FaceSample[] => {
        const win = footageWindow(src, fmt, cy, cropX);
        const k = size.width / win.width;
        return times.map((tS, i) => ({ tS, faces: (sourceFaces[i] ?? []).map((b) => ({ left: (b.left - win.left) * k, top: (b.top - win.top) * k, width: b.width * k, height: b.height * k })) }));
      };
      const groundAt = async (cy: number, i: number, bands: Buffer) => {
        const win = footageWindow(src, fmt, cy, cropX);
        return sharp(join(sdir, frames[i]!)).extract({ left: Math.round(win.left), top: Math.round(win.top), width: Math.round(win.width), height: Math.round(win.height) }).resize(size.width, size.height).composite([{ input: bands }]).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      };

      // O54 / O56 / O57: at each crop, A then B; the first pair whose face and contrast pass is the clip's.
      type Pick = { cy: number; layout: ClipLayout; face: FaceVerdict; topStep: number; bottomStep: number; p95: { top: number; lockup: number | null; bottom: number } };
      let chosen: Pick | null = null;
      let bestFace: FaceVerdict | null = null;
      let tooBright: string | null = null;
      // O65: every crop × arrangement tried, with both figures.
      const tried: string[] = [];
      const arrangementsSeen: ("A" | "B")[] = [];
      const pc = (v: number) => `${(v * 100).toFixed(1)} %`;
      search: for (const cy of cands) {
        for (const arr of ["A", "B"] as const) {
          arrangementsSeen.push(arr);
          const l = planClipLayout({ lockup, name: namePiece, date: datePiece!, claim: claimPlan }, fmt, arr);
          const fv = judgeFaceOverTime(samplesFor(cy), { always: arr === "A" ? [l.boxes.top] : [l.boxes.top, l.boxes.date], claim: l.boxes.claim }, { frameWidth: size.width });
          if (!bestFace || Math.max(fv.topShare, fv.claimShare) < Math.max(bestFace.topShare, bestFace.claimShare)) bestFace = fv;
          const triedFace = `crop ${cy} · ${arr}: face ${pc(fv.topShare)} / ${pc(fv.claimShare)}, run ${fv.longestRunS.toFixed(1)} s`;
          if (!fv.ok) {
            tried.push(`${triedFace} → ${fv.line}`);
            continue;
          }
          // O57: the top block (and the lockup alone, O61) and the bottom block per band step, p95 over the samples.
          const tops: number[][] = T1C.bandSteps.map(() => []);
          const locks: number[][] = T1C.bandSteps.map(() => []);
          const bots: number[][] = T1C.bandSteps.map(() => []);
          for (const [si, st] of T1C.bandSteps.entries()) {
            const bands = await bandsFor(l, { top: st, bottom: st });
            for (let i = 0; i < frames.length; i += 1) {
              const g = await groundAt(cy, i, bands);
              tops[si]!.push(lowContrastShare(g.data, g.info.width, g.info.channels, l.boxes.top));
              if (l.boxes.lockup) locks[si]!.push(lowContrastShare(g.data, g.info.width, g.info.channels, l.boxes.lockup));
              if (claimOn(times[i]!) || arr === "B") bots[si]!.push(lowContrastShare(g.data, g.info.width, g.info.channels, l.boxes.bottom));
            }
          }
          const topP = tops.map((v) => nearestRank(v, 95));
          const lockP = locks.map((v) => (v.length ? nearestRank(v, 95) : 0));
          const botP = bots.map((v) => (v.length ? nearestRank(v, 95) : 0));
          const topStep = topP.findIndex((v, i) => v <= T1V_CONTRAST.topBlock + 1e-9 && lockP[i]! <= T1C.lockupMax + 1e-9);
          const bottomStep = chooseStep(botP, T1V_CONTRAST.claimBox);
          if (topStep < 0) {
            tooBright ??= T1V_LINES.tooBright("name");
            tried.push(`${triedFace} → top p95 ${topP.map(pc).join(" / ")} at +0 / +10 / +20 → ${T1V_LINES.tooBright("name")}`);
            continue;
          }
          if (bottomStep == null) {
            tooBright ??= T1V_LINES.tooBright("claim");
            tried.push(`${triedFace} → bottom p95 ${botP.map(pc).join(" / ")} at +0 / +10 / +20 → ${T1V_LINES.tooBright("claim")}`);
            continue;
          }
          tried.push(`${triedFace} → passes (top +${Math.round(T1C.bandSteps[topStep]! * 100)}, bottom +${Math.round(T1C.bandSteps[bottomStep]! * 100)})`);
          chosen = { cy, layout: l, face: fv, topStep, bottomStep, p95: { top: topP[topStep]!, lockup: l.boxes.lockup ? lockP[topStep]! : null, bottom: botP[bottomStep]! } };
          break search;
        }
      }
      // A refused clip is still drawn as the flagged preview, on its own crop in A.
      const refused = chosen ? null : (tooBright ?? bestFace?.line ?? "refused");
      const layout = chosen?.layout ?? planClipLayout({ lockup, name: namePiece, date: datePiece!, claim: claimPlan }, fmt, "A");
      const cropY = chosen?.cy ?? own;
      const steps = { top: T1C.bandSteps[chosen?.topStep ?? 0]!, bottom: T1C.bandSteps[chosen?.bottomStep ?? 0]! };
      const bands = await bandsFor(layout, steps);

      // O58: the red line stays red: band step first, then a backing under line 1, 40 → 60 → 80 %; white only past 80 %.
      let red: RedVerdict | null = null;
      let redP95: number | null = null;
      let backing: BackingBox | null = null;
      const l1 = layout.claim[0];
      if (l1 && l1.color === "red") {
        // O66: the neighbours are line 2's cap top below and the nearest type's baseline above (the date in B, else the top block).
        const above = layout.arrangement === "B" ? layout.pieces.date.at.top + layout.pieces.date.piece.capPx * layout.pieces.date.at.scale : layout.boxes.top.top + layout.boxes.top.height;
        backing = backingRect(l1, size.width, { below: layout.claim[1] ? layout.claim[1].capTop : undefined, above });
        const byStep: number[][] = [[], ...RED_BACKING.steps.map(() => [])];
        for (let i = 0; i < frames.length; i += 1) {
          if (!claimOn(times[i]!)) continue;
          const g = await groundAt(cropY, i, bands);
          byStep[0]!.push(redLineVerdict(g.data, g.info.width, g.info.channels, l1, size).share);
          for (const [bi, op] of RED_BACKING.steps.entries()) byStep[bi + 1]!.push(redLineVerdict(applyBacking(g.data, g.info.width, g.info.height, g.info.channels, backing!, op), g.info.width, g.info.channels, l1, size).share);
        }
        const p95s = byStep.map((v) => nearestRank(v, 95));
        red = chooseBacking(p95s, "clip");
        redP95 = red.backing != null ? p95s[RED_BACKING.steps.indexOf(red.backing as 0.4 | 0.6 | 0.8) + 1]! : p95s[0]!;
      }

      // Type layers. The top layer (lockup, name, date; on from frame 0) carries the draft stamp; the claim layer
      // (the backing, then the claim's lines) fades in at 1.5 s (O37, O58).
      const lp = layout.pieces;
      const topPieces = [...(lp.lockup ? [lp.lockup] : []), lp.name, lp.date];
      const typeTop = await layer(topPieces.map((p) => p.piece), topPieces.map((p) => p.at), fmt);
      const claimPieces: Piece[] = [];
      const claimPlaces: Placement[] = [];
      for (const [i, line] of layout.claim.entries()) {
        const colour = line.color === "red" && (i > 0 || !red?.white) ? KIT_RED : KIT_WHITE;
        const set = await renderCardLine(line.text, colour, line.capPx, face);
        claimPieces.push({ png: set.png, width: set.width, height: set.height, capPx: line.capPx, label: line.text });
        claimPlaces.push({ label: line.text, left: Math.round((size.width - set.width) / 2), top: Math.round(line.capTop - set.capTopRow), width: set.width, height: set.height, scale: 1, short: false, stepped: false, belowFloor: false });
      }
      let typeClaim = claimPieces.length ? await layer(claimPieces, claimPlaces, fmt) : null;
      if (typeClaim && backing && red?.backing != null) {
        const back = await rgbaPng(backingLayer(size.width, size.height, backing, red.backing), size);
        typeClaim = await sharp(back).composite([{ input: typeClaim }]).png().toBuffer();
      }
      // O36 / O62: the stamp in the first free corner of the 4:5 rectangle, never touching the lockup.
      const avoid = [...topPieces.map((p) => p.at), ...claimPlaces];
      const within = fmt === "9:16" ? { left: 0, top: 285, width: 1080, height: 1350 } : { left: 0, top: 0, width: size.width, height: size.height };
      const stamp = job.wm ? await watermarkLayer(job.wm, size, face.path, face.family ?? "Bootzy Condensed TM", { avoid, within }) : null;
      const topWithStamp = stamp ? await sharp(typeTop).composite([{ input: stamp }]).png().toBuffer() : typeTop;

      writeFileSync(join(work, `${id}-top.png`), topWithStamp);
      writeFileSync(join(work, `${id}-bands.png`), bands);
      if (typeClaim) writeFileSync(join(work, `${id}-claim.png`), typeClaim);
      const here = !lambda || (Number.isFinite(localFrom) && src.width >= localFrom);
      const clipSigned = !here ? (await db.storage.from("campaign-assets").createSignedUrl(String(asset.data!.storage_path), 3600)).data?.signedUrl : null;
      const props: T1OnClipProps = {
        clipUrl: !here ? clipSigned! : `${base}/${clipFile}`,
        format: fmt,
        sourceWidth: src.width,
        sourceHeight: src.height,
        cropFocusY: cropY,
        cropFocusX: cropX,
        inS,
        fps,
        durationInSeconds: dur,
        muted: true,
        bandsUrl: !here ? dataUri(bands) : `${base}/${id}-bands.png`,
        topUrl: !here ? dataUri(topWithStamp) : `${base}/${id}-top.png`,
        claimUrl: typeClaim ? (!here ? dataUri(typeClaim) : `${base}/${id}-claim.png`) : null,
      };
      const out = join(outDir, `${id}_DRAFT${refused ? "_REFUSED" : ""}.mp4`);
      // A stamped draft is refused by the export guard. A no-CTA card has no claim to approve and no stamp; this script has no export path.
      if (job.wm) {
        try {
          assertExportable({ watermark: job.wm });
          fail(`${id}: the export guard let a stamped draft through`);
        } catch (e) {
          if ((e as Error).name !== "NotExportableError") throw e;
        }
      }
      let renderedOn = "local";
      if (lambda && !here) {
        renderedOn = "Lambda";
        const nFrames = Math.round(dur * fps);
        const chunk = lambdaChunking(lambda.limit, nFrames);
        const started = Date.now();
        const r = await renderMediaOnLambda({ region: REMOTION_REGION, functionName: lambda.functionName, serveUrl: lambda.serveUrl, composition: "T1OnClip", inputProps: props as unknown as Record<string, unknown>, codec: "h264", crf: 18, muted: true, framesPerLambda: chunk.framesPerLambda, concurrencyPerLambda: chunk.concurrencyPerLambda, privacy: "private", downloadBehavior: { type: "download", fileName: null } });
        let progress = await getRenderProgress({ renderId: r.renderId, bucketName: r.bucketName, functionName: lambda.functionName, region: REMOTION_REGION });
        while (!progress.done && !progress.fatalErrorEncountered) {
          await new Promise((res) => setTimeout(res, 2000));
          progress = await getRenderProgress({ renderId: r.renderId, bucketName: r.bucketName, functionName: lambda.functionName, region: REMOTION_REGION });
        }
        if (progress.fatalErrorEncountered || !progress.outKey) {
          // Delete what the failed render left in S3, note it, and go on to the next draft.
          await deleteRender({ bucketName: r.bucketName, region: REMOTION_REGION, renderId: r.renderId });
          const why = progress.errors.map((e) => e.message.split("\n")[0]).join("; ");
          console.error(`${id}: Lambda render failed (render deleted): ${why}`);
          lambdaFailed.push({ id, why: why.slice(0, 300) });
          continue;
        }
        const { GetObjectCommand } = await import("@aws-sdk/client-s3");
        const { LambdaClientInternals } = await import("@remotion/lambda/client");
        const s3 = LambdaClientInternals.getS3Client({ region: REMOTION_REGION, customCredentials: null, forcePathStyle: false, requestHandler: null });
        const obj = await s3.send(new GetObjectCommand({ Bucket: r.bucketName, Key: progress.outKey! }));
        writeFileSync(out, Buffer.from(await obj.Body!.transformToByteArray()));
        await deleteRender({ bucketName: r.bucketName, region: REMOTION_REGION, renderId: r.renderId });
        const functions = Math.ceil(nFrames / (chunk.framesPerLambda ?? nFrames)) + 1;
        lambdaCosts.push({ id, functions, costUsd: progress.costs?.accruedSoFar ?? null, ms: Date.now() - started });
        console.log(`  lambda: ${functions} functions · $${(progress.costs?.accruedSoFar ?? 0).toFixed(4)} · ${((Date.now() - started) / 1000).toFixed(0)} s`);
      } else {
        const composition = await selectComposition({ serveUrl, id: "T1OnClip", inputProps: props as unknown as Record<string, unknown> });
        await renderMedia({ composition, serveUrl, codec: "h264", crf: 18, outputLocation: out, inputProps: props as unknown as Record<string, unknown>, muted: true, logLevel: "error" });
      }
      contactRows.push({ label: `${id} · ${layout.arrangement}${refused ? " · REFUSED (flagged preview)" : ""}`, file: out });
      const fv = chosen?.face ?? bestFace!;
      // O70: the backing's feather, checked on the backing layer alone over flat mid-grey.
      const feather: FeatherCheck[] = backing && red?.backing != null && l1
        ? [checkFeather(backing, red.backing, "bottom", size), checkFeather(backing, red.backing, "top", size)]
        : [];
      const redWord = !red ? "–" : red.white ? "white (whole clip)" : red.backing != null ? `red, backed ${Math.round(red.backing * 100)} %` : "red";
      const stepWord = chosen ? `top +${Math.round(steps.top * 100)} · bottom +${Math.round(steps.bottom * 100)}` : "–";
      console.log(`${id}: ${layout.arrangement} · crop ${cropY} · ${refused ?? "passes"} · steps ${stepWord} · red ${redWord}`);
      const safe = fmt !== "9:16" || insideVideoSafe([...topPieces.map((p) => p.at), ...layout.claim.map((c) => ({ left: (size.width - c.widthPx) / 2, top: c.capTop, width: c.widthPx, height: c.capPx }))]).ok;
      table.push({
        clip: clipId.slice(0, 8),
        artist,
        claimLabel: job.label,
        fmt,
        // O73: a refused row lists every arrangement tried.
        arrangement: chosen ? layout.arrangement : arrangementsTried(arrangementsSeen),
        crop: chosen?.cy ?? null,
        scale: upscaleFactor(src, fmt, cropY, cropX),
        tried,
        faceLine: fv.ok ? "ok" : (fv.line ?? "refused"),
        topShare: fv.topShare,
        claimShare: fv.claimShare,
        runS: fv.longestRunS,
        topP95: chosen?.p95.top ?? null,
        lockupP95: chosen?.p95.lockup ?? null,
        bottomP95: chosen?.p95.bottom ?? null,
        steps: stepWord,
        redP95,
        red: redWord,
        feather,
        claim: !job.text ? "no CTA" : !allowed.ok ? allowed.line : claimPlan ? `step ${claimPlan.step}${claimPlan.dropped.length ? ` · dropped ${claimPlan.dropped.join(", ")}` : ""} · ${Math.round(claimPlan.widest)} of 840 px` : (plan as { held: string }).held,
        safe,
        file: `${id}_DRAFT${refused ? "_REFUSED" : ""}.mp4`,
        renderedOn,
        result: refused ? `refused: ${refused}` : "passes",
      });
    }
  }
}

// ─── O46 on the encoded file: a flat mid-grey test clip through the composition (local) ─
const greyFile = "grey-test.mp4";
await sharp({ create: { width: 1080, height: 1920, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toFile(join(work, "grey.png"));
ff("ffmpeg", ["-y", "-v", "error", "-loop", "1", "-framerate", "30", "-i", join(work, "grey.png"), "-t", "2", "-c:v", "libx264", "-crf", "0", "-pix_fmt", "yuv444p", join(work, greyFile)]);
// The 9:16 A layout with a one-line claim (O55's anchors; for a one-line claim in A the bottom band is O38's).
const greyName = await piece(kit.pieces.find((p) => p.role === "name")!);
const greyPlan = (await withWidths((m) => planVideoClaim("General sale", m, { releaseNames }))) as VideoClaimPlan; // any one-line claim: it only anchors A's bands
const greyLayout = planClipLayout({ lockup, name: greyName, date: datePiece!, claim: greyPlan }, "9:16", "A");
const greyKnees = [Math.floor(greyLayout.anchors.topFull + 1e-9), Math.floor(greyLayout.anchors.bottomFull + 1e-9)];
writeFileSync(join(work, "grey-bands.png"), await rgbaPng(renderVideoBands(1080, 1920, clipBands(greyLayout)), { width: 1080, height: 1920 }));
writeFileSync(join(work, "grey-top.png"), await transparent("9:16"));
const greyProps: T1OnClipProps = { clipUrl: `${base}/${greyFile}`, format: "9:16", sourceWidth: 1080, sourceHeight: 1920, cropFocusY: 0.5, fps: 30, durationInSeconds: 2, muted: true, bandsUrl: `${base}/grey-bands.png`, topUrl: `${base}/grey-top.png`, claimUrl: null };
const greyOut = join(outDir, "grey-test_bands_crf18.mp4");
const greyComp = await selectComposition({ serveUrl, id: "T1OnClip", inputProps: greyProps as unknown as Record<string, unknown> });
await renderMedia({ composition: greyComp, serveUrl, codec: "h264", crf: 18, outputLocation: greyOut, inputProps: greyProps as unknown as Record<string, unknown>, muted: true, logLevel: "error" });
ff("ffmpeg", ["-y", "-v", "error", "-ss", "1", "-i", greyOut, "-frames:v", "1", join(work, "grey-frame.png")]);
const gf = await sharp(join(work, "grey-frame.png")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const means = rowMeanLuma(gf.data, gf.info.width, gf.info.height, gf.info.channels);
const steps = Array.from(means, (m, y) => (y ? Math.abs(m - means[y - 1]!) : 0));
const kneeNear = (y: number) => greyKnees.some((k) => Math.abs(k - y) <= 1);
const fadeMax = Math.max(...steps.filter((_, y) => !kneeNear(y)));
const kneeSteps = greyKnees.map((k) => Math.max(steps[k - 1] ?? 0, steps[k]!, steps[k + 1] ?? 0));

// ─── Contact sheet: 0 / 1.5 / 1.75 / 4.75 s ──────────────────────────────────
const TIMES = [0, 1.5, 1.75, 4.75];
const TH = 320;
const tiles: sharp.OverlayOptions[] = [];
let y = 16;
let sheetW = 0;
for (const r of contactRows) {
  let x = 16;
  const label = await sharp({ text: { text: `<span foreground="#ffffff">${r.label.replace(/&/g, "&amp;")}</span>`, font: "Helvetica 14", rgba: true, dpi: 72 } }).png().toBuffer();
  tiles.push({ input: label, left: x, top: y });
  y += 22;
  for (const ts of TIMES) {
    const f = join(work, `cs-${r.label.replace(/[^\w.-]+/g, "_")}-${ts}.png`);
    ff("ffmpeg", ["-y", "-v", "error", "-ss", String(ts), "-i", r.file, "-frames:v", "1", f]);
    const img = await sharp(f).resize({ height: TH }).png().toBuffer();
    const meta = await sharp(img).metadata();
    tiles.push({ input: img, left: x, top: y });
    const t = await sharp({ text: { text: `<span foreground="#cccccc">${ts} s</span>`, font: "Helvetica 12", rgba: true, dpi: 72 } }).png().toBuffer();
    tiles.push({ input: t, left: x, top: y + TH + 2 });
    x += (meta.width ?? 0) + 10;
  }
  sheetW = Math.max(sheetW, x + 6);
  y += TH + 26;
}
if (contactRows.length) await sharp({ create: { width: sheetW, height: y + 10, channels: 3, background: "#1a1a1a" } }).composite(tiles).png().toFile(join(outDir, "CONTACT-SHEET.png"));

// ─── report.md ───────────────────────────────────────────────────────────────
const pct = (v: number | null) => (v == null ? "–" : `${(v * 100).toFixed(1)} %`);
const L: string[] = [];
L.push(`# T1 on a clip · drafts · ${code} · ${event.name} · ${new Date().toISOString().slice(0, 16)}Z`, "");
L.push(`ticket_warnings, read live (select only): ${rows.map((r) => `${r.id.slice(0, 8)} "${r.claim.replace(/\n/g, " / ")}" ${r.state}`).join(" · ")}.`);
L.push(`Versions (Matas, 10 Nov): ${versions.map((v) => `${v.id} — ${v.title}${v.claim ? ` "${v.claim.replace("\n", " / ")}"` : ""}, ${v.why}${v.watermark ? `, stamped "${v.watermark}"` : ""}`).join("; ")}.`);
L.push(`Release names for the break rule (event_releases, select only): ${releaseNames.join(" · ") || "none"}.`);
L.push(onLambda
  ? `Kit face: provided by Puzzle (cleared, O49; recorded in kit-faces.ts, O51), fetched for this run from the private kit-fonts bucket through a one-hour signed URL, its PostScript name checked, then set by sharp from a temporary file (O52). Lambda received the clip as a signed URL and the type and bands as images in the props; its site (${DRAFT_SITE}) carries no kit font.`
  : `Kit face: provided by Puzzle (cleared, O49), read in place from FONTS_DIR, never copied or committed. Local Remotion renders.`);
for (const f of lambdaFailed) L.push(`Lambda render failed for ${f.id} (its S3 render deleted, no draft): ${f.why}`);
if (lambdaCosts.length) {
  const total = lambdaCosts.reduce((a, c) => a + (c.costUsd ?? 0), 0);
  L.push(`Lambda: ${lambdaCosts.length} renders, ${lambdaCosts[0]!.functions} functions each (one orchestrator plus the chunks), $${(total / lambdaCosts.length).toFixed(4)} a render on average, $${total.toFixed(4)} in all.`);
}
L.push(`Each clip: its first ${seconds} s from in_s, muted, H.264 CRF 18. Samples at ${T1V_FACE.fps} a second.`, "");
L.push(`The roll-call, from Puzzle's tiers (${tiers.map((t) => `${t.name} ${t.state}`).join(" · ")}): "${rollCall.claim!.replace("\n", " / ")}".`, "");
L.push("| Clip | Version | Format | Arrangement | Crop | Scale (O63, ≤ 1.6×) | Face (O64): top / claim share · run | Top block p95 (≤ 10 %) | Lockup p95 (≤ 15 %) | Bottom block p95 (≤ 15 %) | Band steps (O57) | Red line p95 → result (O58) | Claim | Safe area | Result | Rendered | File |");
L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of table) L.push(`| ${r.artist} (${r.clip}) | ${r.claimLabel} | ${r.fmt} | ${r.arrangement} | ${r.crop ?? "–"} | ${r.scale == null ? "–" : `${r.scale.toFixed(2)}×`} | ${pct(r.topShare)} / ${pct(r.claimShare)} · ${r.runS.toFixed(1)} s | ${pct(r.topP95)} | ${pct(r.lockupP95)} | ${pct(r.bottomP95)} | ${r.steps} | ${pct(r.redP95)} → ${r.red} | ${r.claim} | ${r.safe ? "✓" : "✗"} | ${r.result} | ${r.renderedOn ?? "–"} | ${r.file ?? "–"} |`);
L.push("", ...triedSection(table.map((r) => ({ heading: `${r.artist} (${r.clip}) · ${r.claimLabel} · ${r.fmt}`, lines: r.tried }))));
L.push("Scaling (O69): upscales up to 1.6× use the renderer's own filter; no upscaled copy is stored. Footage read from: " + readFrom.join(" · ") + ".");
L.push("", "## The backing's feather (O70)");
L.push("Each backed draft's backing layer alone over flat mid-grey, each row's mean level across the core's width, over the feather's rows only (the last core row to the first row at 0; the padding isn't read): the largest row-to-row step against the feather's mean step, the drop over the feather's length in rows (limit 1.6×; a smoothstep peaks at 1.5×).");
for (const r of table) for (const f of r.feather) L.push(`- ${r.artist} (${r.clip}) · ${r.claimLabel} · ${r.fmt} · ${f.side}: ${f.rows} feather rows, mean step ${f.meanStep.toFixed(2)}, largest ${f.maxStep.toFixed(2)} → ${f.ratio.toFixed(2)}× → ${f.ok ? "passes" : "fails"}`);
if (!table.some((r) => r.feather.length)) L.push("- No draft in this run took a backing.");
L.push("", "## O46 on the encoded file");
L.push(`A flat 0x808080 1080 × 1920 clip through T1OnClip with the bands only, H.264 CRF 18 (grey-test_bands_crf18.mp4), frame at 1 s. Largest step between adjacent rows' mean luma across the fades: ${fadeMax.toFixed(2)} levels (limit ${MAX_ROW_STEP}) → ${fadeMax <= MAX_ROW_STEP ? "passes" : "fails"}. At J2's two knees (rows ${greyKnees.join(", ")}, A's top and bottom bands): ${kneeSteps.map((k) => k.toFixed(2)).join(" / ")} levels (limit ${MAX_KNEE_STEP}, O55) → ${kneeSteps.every((k) => k <= MAX_KNEE_STEP) ? "passes" : "fails"}.`);
L.push("", "## T1V_INVENTED and its rulings (issue 8, O62)");
for (const i of T1V_INVENTED) L.push(`- **${i.ruling}**: ${i.value}`);
L.push("", `Contact sheet: CONTACT-SHEET.png (frames at ${TIMES.join(" / ")} s).`);
// H65: never write a tried section with a heading and nothing under it.
const emptyTried = emptyTriedHeadings(L.join("\n"));
if (emptyTried.length) fail(`report.md: no crop or arrangement listed under ${emptyTried.join("; ")}`);
writeFileSync(join(outDir, "report.md"), L.join("\n") + "\n");
server.close();
if (lambda) {
  await deleteSite({ bucketName: lambda.bucketName, region: REMOTION_REGION, siteName: DRAFT_SITE });
  siteLeft = null;
}
faceTmp?.done();
console.log(`wrote ${contactRows.length} drafts, CONTACT-SHEET.png and report.md to ${outDir}`);
