/**
 * Draft triple-fits (overlay templates issue 16, H106) for Matas to judge.
 * One landscape clip in three 1080 × 640 parts of one 9:16, through one
 * window, in sync, with the clip's own sound once (O109, O110). T1 on a clip,
 * arrangement B only, inside issue 15's band and clear of the seams (O111).
 * One face test against the union of the type in the part's coordinates
 * (O112). TF1's band, seams and parts are drawn over the draft (drafts only).
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/triple-fit-drafts.mts \
 *     --event P26-BDAY --kit <the static PSD's kit folder> --out .scratch/drafts/triple-fit-2026-11-11 \
 *     --clip '<clip id>' [--clip …] [--seconds 8] [--lambda]
 *
 * Read only against the database and Storage; nothing is written but --out.
 * No Drive, no approvals, no exports: every claim draft carries its stamp.
 * --lambda: as scripts/t1-video-drafts.mts (issue 7, O52/O53). The kit face is
 * fetched per run from the private kit-fonts bucket and name-checked; the
 * site is deployed under its own name and removed afterwards, and each S3
 * render is deleted once downloaded. Built from the T1 drafts script, which
 * stays as it is.
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
  insideVideoSafe,
  judgeFaceOverTime,
  nearestRank,
  planClipLayout,
  planVideoClaim,
  releaseNamesOf,
  sampleTimes,
  type BackingBox,
  type ClipLayout,
  type FaceSample,
  type FaceVerdict,
  type MeasureCap,
  type RedVerdict,
  type VideoClaimPlan,
  type VideoFormat,
  arrangementsTried,
} from "../lib/creative-lab/t1-video.ts";
import { applyBacking, backingLayer, checkFeather, type FeatherCheck } from "../lib/creative-lab/red-backing.ts";
import { emptyTriedHeadings, triedSection } from "../lib/creative-lab/draft-report.ts";
import { draftVersions, releaseFromRow, type DraftVersion } from "../lib/creative-lab/draft-versions.ts";
import { VIDEO_BAND, bandWord } from "../lib/creative-lab/video-band.ts";
import { SEAM_ZONES, TRIPLE_FIT, clipKind, facesInPart, partCropCandidates, partFaceBoxes, partWindow, tripleFitLength, tripleFitSound, tripleFitTypeChecks, tripleFitUpscale, type PartWindow } from "../lib/creative-lab/triple-fit.ts";
import { MAX_KNEE_STEP, MAX_ROW_STEP, renderVideoBands, rowMeanLuma } from "../lib/creative-lab/video-bands.ts";
import type { TripleFitOnClipProps } from "../src/remotion/compositions/TripleFitOnClip.tsx";

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
const DRAFT_SITE = "creative-lab-triple-fit-drafts";
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
const FORMATS: VideoFormat[] = ["9:16"]; // O95: a triple-fit is one 9:16
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

/** H106: TF1 drawn over the draft — the band, the type's top and last baseline, the seams' no-type zones and the part labels. Drafts only. */
let guideCache: Buffer | null = null;
async function guideLayer(): Promise<Buffer> {
  if (guideCache) return guideCache;
  const B = VIDEO_BAND;
  const zones = SEAM_ZONES.map((z) => `<rect x="0" y="${z.top}" width="1080" height="${z.bottom - z.top}" fill="#ff3b30" fill-opacity="0.18"/><line x1="0" y1="${z.seam}" x2="1080" y2="${z.seam}" stroke="#ff3b30" stroke-width="2" stroke-dasharray="10 8"/><text x="1064" y="${z.top - 6}" text-anchor="end" font-family="Helvetica" font-size="20" fill="#ff3b30">no type ${z.top}–${z.bottom}</text>`).join("");
  const parts = TRIPLE_FIT.partTops.map((top, i) => `<text x="16" y="${top + 30}" font-family="Helvetica" font-weight="bold" font-size="22" fill="#ffd60a">PART ${i + 1}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
    <rect x="${B.left}" y="${B.top}" width="${B.right - B.left}" height="${B.bottom - B.top}" fill="none" stroke="#30d158" stroke-width="2" stroke-dasharray="6 6"/>
    <line x1="${B.left}" y1="${B.firstInk}" x2="${B.right}" y2="${B.firstInk}" stroke="#30d158" stroke-width="1.5"/>
    <line x1="${B.left}" y1="${B.lastBaseline}" x2="${B.right}" y2="${B.lastBaseline}" stroke="#30d158" stroke-width="1.5"/>
    <text x="${B.left + 6}" y="${B.top - 8}" font-family="Helvetica" font-size="18" fill="#30d158">issue 15's band · type ${B.firstInk}–${B.lastBaseline}</text>
    ${zones}${parts}
  </svg>`;
  guideCache = await sharp(Buffer.from(svg)).png().toBuffer();
  return guideCache;
}

// ─── Per clip ────────────────────────────────────────────────────────────────
const readFrom: string[] = [];
const sources = new Map<string, string>();
type Row = { clip: string; artist: string; claimLabel: string; fmt: VideoFormat; arrangement: string; crop: string | null; scale: number | null; win?: PartWindow; union?: string; sound?: string; stills?: string[]; tried: string[]; faceLine: string; topShare: number; claimShare: number; runS: number; topP95: number | null; lockupP95: number | null; bottomP95: number | null; steps: string; redP95: number | null; red: string; feather: FeatherCheck[]; claim: string; safe: boolean; band?: string; file: string | null; result: string; renderedOn?: string };
const table: Row[] = [];
const contactRows: { label: string; file: string }[] = [];

for (const clipId of clipIds) {
  // select * so a render copy (O68, render-source.ts) is read when the import follow-up has added one. Read only.
  const c = await db.from("creative_lab_clips").select("*").eq("id", clipId).maybeSingle();
  if (c.error || !c.data) fail(`clip ${clipId}`);
  const clip = c.data!;
  const art = await db.from("creative_lab_artists").select("name").eq("id", clip.artist_id).maybeSingle();
  const artist = String(art.data?.name ?? "?");
  const asset = await db.from("creative_assets").select("*").eq("id", clip.creative_asset_id).maybeSingle();
  if (asset.error || !asset.data) fail(`asset for ${clipId}`);
  // O109: a triple-fit reads the original. A clip's render copy (render_asset_id) is a whole-frame 1080 proxy or
  // #1182's 9:16 column, never the part window, so it isn't used here; the part window's own copy is a follow-up.
  const sourcePath = String(asset.data!.storage_path ?? "");
  if (!sourcePath) fail(`${clipId}: its original isn't in Storage (a Drive master, migration 228); a triple-fit needs the part window's own copy`);
  readFrom.push(`${clipId.slice(0, 8)}: the original (creative_assets ${String(asset.data!.id).slice(0, 8)}, ${sourcePath})`);
  const file = await db.storage.from("campaign-assets").download(sourcePath);
  if (file.error || !file.data) fail(`download ${clipId}`);
  const slug = `${artist.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${clip.clip_no}`;
  const clipFile = `${slug}.mp4`;
  writeFileSync(join(work, clipFile), Buffer.from(await file.data!.arrayBuffer()));
  const hasAudio = ff("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", join(work, clipFile)]).trim().length > 0;
  const probe = JSON.parse(ff("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", join(work, clipFile)])) as { streams: { width: number; height: number; r_frame_rate: string }[]; format: { duration: string } };
  const src = { width: probe.streams[0]!.width, height: probe.streams[0]!.height };
  sources.set(clipId.slice(0, 8), `${src.width} × ${src.height}`);
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
      const cropX = Number(clip.crop_focus_x ?? 0.5);
      const own = Number(clip.crop_focus_y ?? 0.5);
      // O108 / O63 / O109: a triple-fit clip, its window at most 1.6× to 1080, at least 6 s stored.
      const kind = clipKind(src);
      const up = tripleFitUpscale(src, cropX, own);
      const length = tripleFitLength(inS, inS + full);
      const small = kind.kind === "916" ? "Makes its own 9:16 — runs as itself, never a triple-fit (O108)" : kind.kind === "too-small" ? kind.line : !up.ok ? up.line : !length.ok ? length.line : null;
      if (small) {
        console.log(`${id}: ${small}`);
        table.push({ clip: clipId.slice(0, 8), artist, claimLabel: job.label, fmt, arrangement: "–", crop: null, scale: up.scale, win: up.window, tried: [], faceLine: small, topShare: 0, claimShare: 0, runS: 0, topP95: null, lockupP95: null, bottomP95: null, steps: "–", redP95: null, red: "–", feather: [], claim: "–", safe: true, file: null, result: small });
        continue;
      }
      // O112: crop candidates along the window's slack, tried once for the clip (all three parts share the window).
      type Crop = { x: number; y: number };
      const cands: Crop[] = partCropCandidates(src, { x: cropX, y: own });
      const samplesFor = (c: Crop): FaceSample[] => facesInPart(times.map((tS, i) => ({ tS, faces: sourceFaces[i] ?? [] })), partWindow(src, c.x, c.y));
      // The 9:16 as the composition draws it: the window at 1080 × 640, three times, then the bands.
      const partCache = new Map<string, Buffer>();
      const partAt = async (c: Crop, i: number) => {
        const key = `${c.x}:${c.y}:${i}`;
        const hit = partCache.get(key);
        if (hit) return hit;
        const w = partWindow(src, c.x, c.y);
        const png = await sharp(join(sdir, frames[i]!)).extract({ left: Math.round(w.left), top: Math.round(w.top), width: w.width, height: w.height }).resize(TRIPLE_FIT.part.width, TRIPLE_FIT.part.height, { kernel: "lanczos3" }).png().toBuffer();
        partCache.set(key, png);
        return png;
      };
      const groundAt = async (c: Crop, i: number, bands: Buffer) => {
        const part = await partAt(c, i);
        return sharp({ create: { width: size.width, height: size.height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
          .composite([...TRIPLE_FIT.partTops.map((top) => ({ input: part, left: 0, top })), { input: bands }])
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
      };

      // O111 / O112 / O57: at each crop, B only (A's date crosses the 640 seam); the first whose face and contrast pass is the clip's.
      type Pick = { cy: Crop; layout: ClipLayout; face: FaceVerdict; topStep: number; bottomStep: number; p95: { top: number; lockup: number | null; bottom: number } };
      let chosen: Pick | null = null;
      let bestFace: FaceVerdict | null = null;
      let tooBright: string | null = null;
      // O65: every crop × arrangement tried, with both figures.
      const tried: string[] = [];
      const arrangementsSeen: ("A" | "B")[] = [];
      const pc = (v: number) => `${(v * 100).toFixed(1)} %`;
      search: for (const cy of cands) {
        for (const arr of ["B"] as const) {
          arrangementsSeen.push(arr);
          const l = planClipLayout({ lockup, name: namePiece, date: datePiece!, claim: claimPlan }, fmt, arr);
          const fv = judgeFaceOverTime(samplesFor(cy), partFaceBoxes(l), { frameWidth: TRIPLE_FIT.part.width });
          if (!bestFace || Math.max(fv.topShare, fv.claimShare) < Math.max(bestFace.topShare, bestFace.claimShare)) bestFace = fv;
          const triedFace = `crop x ${cy.x} y ${cy.y} · ${arr}: face ${pc(fv.topShare)} / ${pc(fv.claimShare)}, run ${fv.longestRunS.toFixed(1)} s`;
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
      const layout = chosen?.layout ?? planClipLayout({ lockup, name: namePiece, date: datePiece!, claim: claimPlan }, fmt, "B");
      const cropY: Crop = chosen?.cy ?? { x: cropX, y: own };
      const win: PartWindow = partWindow(src, cropY.x, cropY.y);
      const sound = tripleFitSound({ hasAudio: hasAudio, audioMatch: clip.audio_match as boolean | null, audioStatus: clip.audio_status as string | null });
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
      const within = fmt === "9:16" ? { left: VIDEO_BAND.left, top: VIDEO_BAND.firstInk, width: VIDEO_BAND.right - VIDEO_BAND.left, height: VIDEO_BAND.lastBaseline - VIDEO_BAND.firstInk } : { left: 0, top: 0, width: size.width, height: size.height };
      const stamp = job.wm ? await watermarkLayer(job.wm, size, face.path, face.family ?? "Bootzy Condensed TM", { avoid, within }) : null;
      const topWithStamp = stamp ? await sharp(typeTop).composite([{ input: stamp }]).png().toBuffer() : typeTop;

      writeFileSync(join(work, `${id}-top.png`), topWithStamp);
      writeFileSync(join(work, `${id}-bands.png`), bands);
      if (typeClaim) writeFileSync(join(work, `${id}-claim.png`), typeClaim);
      const here = !lambda || (Number.isFinite(localFrom) && src.width >= localFrom);
      const clipSigned = !here ? (await db.storage.from("campaign-assets").createSignedUrl(String(asset.data!.storage_path), 3600)).data?.signedUrl : null;
      // H106: TF1's band, seams and parts as an overlay layer, in the draft only.
      const guide = await guideLayer();
      writeFileSync(join(work, `${id}-guide.png`), guide);
      const props: TripleFitOnClipProps = {
        clipUrl: !here ? clipSigned! : `${base}/${clipFile}`,
        sourceWidth: src.width,
        sourceHeight: src.height,
        window: win,
        inS,
        fps,
        durationInSeconds: dur,
        muted: sound.muted,
        bandsUrl: !here ? dataUri(bands) : `${base}/${id}-bands.png`,
        topUrl: !here ? dataUri(topWithStamp) : `${base}/${id}-top.png`,
        claimUrl: typeClaim ? (!here ? dataUri(typeClaim) : `${base}/${id}-claim.png`) : null,
        guideUrl: !here ? dataUri(guide) : `${base}/${id}-guide.png`,
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
        const r = await renderMediaOnLambda({ region: REMOTION_REGION, functionName: lambda.functionName, serveUrl: lambda.serveUrl, composition: "TripleFitOnClip", inputProps: props as unknown as Record<string, unknown>, codec: "h264", crf: 18, muted: sound.muted, framesPerLambda: chunk.framesPerLambda, concurrencyPerLambda: chunk.concurrencyPerLambda, privacy: "private", downloadBehavior: { type: "download", fileName: null } });
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
        const composition = await selectComposition({ serveUrl, id: "TripleFitOnClip", inputProps: props as unknown as Record<string, unknown> });
        await renderMedia({ composition, serveUrl, codec: "h264", crf: 18, outputLocation: out, inputProps: props as unknown as Record<string, unknown>, muted: sound.muted, logLevel: "error" });
      }
      // H106: a still at 0.5 s and at 4 s beside the MP4.
      const stills: string[] = [];
      for (const ts of [0.5, 4]) {
        const still = out.replace(/\.mp4$/, `_${ts}s.png`);
        ff("ffmpeg", ["-y", "-v", "error", "-ss", String(ts), "-i", out, "-frames:v", "1", still]);
        stills.push(still.split("/").pop()!);
      }
      // H102: one audio stream, the clip's (or none for a muted clip).
      const audioStreams = ff("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index,channels", "-of", "csv=p=0", out]).trim().split("\n").filter(Boolean);
      const soundWord = sound.muted ? `silent (${hasAudio ? "muted clip" : "no track"}) · ${audioStreams.length} audio streams` : `the clip's own track once · ${audioStreams.length} audio stream${audioStreams.length === 1 ? "" : "s"}${sound.flag ? ` · ${sound.flag}` : ""}`;
      contactRows.push({ label: `${id} · ${layout.arrangement}${refused ? " · REFUSED (flagged preview)" : ""}`, file: out });
      const fv = chosen?.face ?? bestFace!;
      // O70: the backing's feather, checked on the backing layer alone over flat mid-grey.
      const feather: FeatherCheck[] = backing && red?.backing != null && l1
        ? [checkFeather(backing, red.backing, "bottom", size), checkFeather(backing, red.backing, "top", size)]
        : [];
      const redWord = !red ? "–" : red.white ? "white (whole clip)" : red.backing != null ? `red, backed ${Math.round(red.backing * 100)} %` : "red";
      const stepWord = chosen ? `top +${Math.round(steps.top * 100)} · bottom +${Math.round(steps.bottom * 100)}` : "–";
      console.log(`${id}: ${layout.arrangement} · crop x ${cropY.x} y ${cropY.y} · ${refused ?? "passes"} · steps ${stepWord} · red ${redWord}`);
      const safe = fmt !== "9:16" || insideVideoSafe([...topPieces.map((p) => p.at), ...layout.claim.map((c) => ({ left: (size.width - c.widthPx) / 2, top: c.capTop, width: c.widthPx, height: c.capPx }))]).ok;
      // H103: issue 15's band check plus the seams, on the type as drawn.
      const band = bandWord(tripleFitTypeChecks(layout));
      const u = partFaceBoxes(layout).union;
      const union = `part-local y ${Math.round(u.top)}–${Math.round(u.bottom)}`;
      table.push({
        band,
        union,
        sound: soundWord,
        stills,
        clip: clipId.slice(0, 8),
        artist,
        claimLabel: job.label,
        fmt,
        // O73: a refused row lists every arrangement tried.
        arrangement: chosen ? layout.arrangement : arrangementsTried(arrangementsSeen),
        crop: chosen ? `x ${chosen.cy.x} y ${chosen.cy.y}` : null,
        scale: 1080 / win.width,
        win,
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
await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toFile(join(work, "grey.png"));
ff("ffmpeg", ["-y", "-v", "error", "-loop", "1", "-framerate", "30", "-i", join(work, "grey.png"), "-t", "2", "-c:v", "libx264", "-crf", "0", "-pix_fmt", "yuv444p", join(work, greyFile)]);
// The triple-fit's B layout with a one-line claim: its bands run across the seams over three grey parts.
const greyName = await piece(kit.pieces.find((p) => p.role === "name")!);
const greyPlan = (await withWidths((m) => planVideoClaim("General sale", m, { releaseNames }))) as VideoClaimPlan; // any one-line claim: it only anchors A's bands
const greyLayout = planClipLayout({ lockup, name: greyName, date: datePiece!, claim: greyPlan }, "9:16", "B");
const greyKnees = [Math.floor(greyLayout.anchors.topFull + 1e-9), Math.floor(greyLayout.anchors.bottomFull + 1e-9)];
writeFileSync(join(work, "grey-bands.png"), await rgbaPng(renderVideoBands(1080, 1920, clipBands(greyLayout)), { width: 1080, height: 1920 }));
writeFileSync(join(work, "grey-top.png"), await transparent("9:16"));
const greyProps: TripleFitOnClipProps = { clipUrl: `${base}/${greyFile}`, sourceWidth: 1920, sourceHeight: 1080, window: partWindow({ width: 1920, height: 1080 }), fps: 30, durationInSeconds: 2, muted: true, bandsUrl: `${base}/grey-bands.png`, topUrl: `${base}/grey-top.png`, claimUrl: null, guideUrl: null };
const greyOut = join(outDir, "grey-test_bands_crf18.mp4");
const greyComp = await selectComposition({ serveUrl, id: "TripleFitOnClip", inputProps: greyProps as unknown as Record<string, unknown> });
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
L.push(`# Triple-fit (overlay templates issue 16) · drafts · ${code} · ${event.name} · ${new Date().toISOString().slice(0, 16)}Z`, "");
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
L.push(`Each clip: its first ${seconds} s from in_s, with its own sound once (O110), H.264 CRF 18. Samples at ${T1V_FACE.fps} a second. Three 1080 × 640 parts through one window (O109); T1 arrangement B only (O111); TF1's band, seams and parts drawn over each draft (drafts only).`, "");
L.push(`The roll-call, from Puzzle's tiers (${tiers.map((t) => `${t.name} ${t.state}`).join(" · ")}): "${rollCall.claim!.replace("\n", " / ")}".`, "");
L.push("| Clip | Source | Version | Arrangement | Crop | Window → part · scale per part (O109, ≤ 1.6×) | Face (O112): top / claim share · run · against | Top block p95 (≤ 10 %) | Lockup p95 (≤ 15 %) | Bottom block p95 (≤ 15 %) | Band steps (O57) | Red line p95 → result (O58) | Claim | Band + seams (H94, H103) | Sound (O110, H102) | Result | Rendered | Files |");
L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of table) L.push(`| ${r.artist} (${r.clip}) | ${sources.get(r.clip) ?? "–"} | ${r.claimLabel} | ${r.arrangement} | ${r.crop ?? "–"} | ${r.win ? `${r.win.width} × ${r.win.height} at (${Math.round(r.win.left)}, ${Math.round(r.win.top)}) → 1080 × 640 · ${r.scale!.toFixed(3)}× (the same in parts 1, 2, 3)` : "–"} | ${pct(r.topShare)} / ${pct(r.claimShare)} · ${r.runS.toFixed(1)} s · ${r.union ?? "–"} | ${pct(r.topP95)} | ${pct(r.lockupP95)} | ${pct(r.bottomP95)} | ${r.steps} | ${pct(r.redP95)} → ${r.red} | ${r.claim} | ${r.band ?? "–"} | ${r.sound ?? "–"} | ${r.result} | ${r.renderedOn ?? "–"} | ${r.file ? [r.file, ...(r.stills ?? [])].join(", ") : "–"} |`);
L.push("", ...triedSection(table.map((r) => ({ heading: `${r.artist} (${r.clip}) · ${r.claimLabel} · ${r.fmt}`, lines: r.tried }))));
L.push("Scaling (O69): upscales up to 1.6× use the renderer's own filter; no upscaled copy is stored. Footage read from: " + readFrom.join(" · ") + ".");
L.push("", "## Invented while drafting (O115 lists the record's own)", "- The one track plays from part 2 (TF1 labels it there); parts 1 and 3 are muted.", "- The window's size is whole pixels, rounded down, as the record's figures (1822, 566).", "- Crop candidates run along the window's slack only: x for a full-height source, y for a full-width one.", "- The guide layer's colours and labels (drafts only).", "- The words for: a clip that makes its own 9:16, a triple-fit under 6 s, A on a triple-fit, a caption on a triple-fit, a promoter triple-fit.");
L.push("", "## The backing's feather (O70)");
L.push("Each backed draft's backing layer alone over flat mid-grey, each row's mean level across the core's width, over the feather's rows only (the last core row to the first row at 0; the padding isn't read): the largest row-to-row step against the feather's mean step, the drop over the feather's length in rows (limit 1.6×; a smoothstep peaks at 1.5×).");
for (const r of table) for (const f of r.feather) L.push(`- ${r.artist} (${r.clip}) · ${r.claimLabel} · ${r.fmt} · ${f.side}: ${f.rows} feather rows, mean step ${f.meanStep.toFixed(2)}, largest ${f.maxStep.toFixed(2)} → ${f.ratio.toFixed(2)}× → ${f.ok ? "passes" : "fails"}`);
if (!table.some((r) => r.feather.length)) L.push("- No draft in this run took a backing.");
L.push("", "## O46 on the encoded file");
L.push(`A flat 0x808080 1920 × 1080 clip through TripleFitOnClip (three grey parts) with the bands only, H.264 CRF 18 (grey-test_bands_crf18.mp4), frame at 1 s. Largest step between adjacent rows' mean luma across the fades: ${fadeMax.toFixed(2)} levels (limit ${MAX_ROW_STEP}) → ${fadeMax <= MAX_ROW_STEP ? "passes" : "fails"}. At J2's two knees (rows ${greyKnees.join(", ")}, B's top and bottom bands, across the seams): ${kneeSteps.map((k) => k.toFixed(2)).join(" / ")} levels (limit ${MAX_KNEE_STEP}, O55) → ${kneeSteps.every((k) => k <= MAX_KNEE_STEP) ? "passes" : "fails"}.`);
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
