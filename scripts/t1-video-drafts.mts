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
 *     --clip '<clip id>' [--clip …] [--seconds 8] [--lambda]
 *
 * --lambda (issue 7, O52/O53): the face comes from the private kit-fonts
 * bucket through a one-hour signed URL and its name is checked
 * (t1-lambda.ts withKitFace) instead of FONTS_DIR; the clip goes to Lambda
 * as a signed Storage URL and the type and bands as data URIs in the props,
 * so nothing is uploaded and no font reaches Lambda or its public site. The
 * site is deployed under its own name (never the production one) and
 * removed afterwards; each S3 render is deleted once downloaded.
 *
 * For each clip: the event's rung-1 claim ("General sale live", held, so
 * "DRAFT · claim not approved") and the sample roll-call ("DRAFT · sample
 * claim"), at 9:16, 4:5 and 1:1. The face (O39) and contrast (O40) are judged
 * on 5-a-second samples; the crop is chosen by O39 (the clip's own first).
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
import { SAMPLE_ROLL_CALL, WATERMARK, approvedClaim, assertExportable, type WarningRow } from "../lib/creative-lab/claim-approval.ts";
import { KIT_RED, KIT_WHITE, renderCardLine } from "../lib/creative-lab/claim-slot.ts";
import { detectFaces } from "../lib/creative-lab/face-detect.ts";
import { providedFace } from "../lib/creative-lab/kit-faces.ts";
import { REMOTION_REGION, lambdaChunking, pickLambdaFunction, readConcurrencyLimit } from "../lib/creative-lab/lambda.ts";
import { withKitFace } from "../lib/creative-lab/t1-lambda.ts";
import { fontsDir, indexFonts, readFontFaces, requireFont } from "../lib/creative-lab/kit-font.ts";
import {
  FORMAT_SIZE,
  T1V_FACE,
  T1V_INVENTED,
  chooseCrop,
  claimAllowed,
  footageWindow,
  insideVideoSafe,
  judgeContrastOverClip,
  judgeFaceOverTime,
  moveRect,
  planVideoClaim,
  releaseNamesOf,
  sampleTimes,
  typeTransform,
  videoTopBlock,
  type ContrastSample,
  type FaceSample,
  type MeasureCap,
  type VideoClaimPlan,
  type VideoFormat,
} from "../lib/creative-lab/t1-video.ts";
import { BAND_KNEE_ROWS_916, MAX_ROW_STEP, renderVideoBands, rowMeanLuma } from "../lib/creative-lab/video-bands.ts";
import type { T1OnClipProps } from "../src/remotion/compositions/T1OnClip.tsx";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const many = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]!] : []));
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
const info = await Promise.all(kit.pieces.filter((p) => p.role === "info").map(piece));
const lockupRec = kit.pieces.find((p) => p.role === "logo");
const lockup = lockupRec ? await piece(lockupRec) : null;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const ev = await db.from("events").select("id, name").eq("event_code", code).maybeSingle();
if (ev.error || !ev.data) fail(`No event ${code}`);
const event = ev.data!;
const tw = await db.from("ticket_warnings").select("id, claim, format, state, approved_by, approved_at, runs_from, runs_to, updated_at").eq("event_id", event.id).range(0, 999);
if (tw.error) fail(`ticket_warnings: ${tw.error.message}`);
const rows = (tw.data ?? []) as (WarningRow & { updated_at: string })[];
const source = approvedClaim(rows, new Date());
const held = rows.find((r) => r.state === "held" && /^general sale live$/i.test(r.claim.trim()));
const rung1 = source.kind === "approved" ? { text: source.claim, why: `approved ${source.id}`, wm: null as string | null } : { text: held?.claim ?? "General sale live", why: held ? `held ticket_warnings ${held.id.slice(0, 8)}, not approved` : "the record's words (no held row), not approved", wm: WATERMARK.notApproved };
const er = await db.from("event_releases").select("name, position").eq("event_id", event.id).range(0, 99);
const releaseNames = er.error ? [] : releaseNamesOf((er.data ?? []) as { name: string; position: number }[]);

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
  lambda = { serveUrl: site.serveUrl, bucketName, functionName: fn!.functionName, limit: await readConcurrencyLimit() };
  console.log(`site ${DRAFT_SITE} deployed (no kit font in it); function ${fn!.functionName}; concurrency ${lambda.limit}`);
}
const lambdaCosts: { id: string; functions: number; costUsd: number | null; ms: number }[] = [];
const dataUri = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

// ─── Layers ──────────────────────────────────────────────────────────────────
const FORMATS: VideoFormat[] = ["9:16", "4:5", "1:1"];
async function bandsPng(fmt: VideoFormat): Promise<Buffer> {
  const master = await sharp(Buffer.from(renderVideoBands(1080, 1920)), { raw: { width: 1080, height: 1920, channels: 4 } }).png().toBuffer();
  if (fmt === "9:16") return master;
  const c45 = await sharp(master).extract({ left: 0, top: 285, width: 1080, height: 1350 }).png().toBuffer();
  return fmt === "4:5" ? c45 : sharp(c45).resize(1080, 1080, { fit: "fill" }).png().toBuffer();
}
const BANDS: Record<VideoFormat, Buffer> = { "9:16": await bandsPng("9:16"), "4:5": await bandsPng("4:5"), "1:1": await bandsPng("1:1") };
const transparent = (fmt: VideoFormat) => sharp({ create: { ...FORMAT_SIZE[fmt], channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();

type Placed = { pieces: Piece[]; places: Placement[] };
async function layer(p: Placed, fmt: VideoFormat): Promise<Buffer> {
  return textOverlay(p.pieces, p.places, FORMAT_SIZE[fmt], typeTransform(fmt), KIT_SHADOW);
}

// ─── Per clip ────────────────────────────────────────────────────────────────
type Row = { clip: string; artist: string; claimLabel: string; fmt: VideoFormat; crop: number | null; faceLine: string; topShare: number; claimShare: number; runS: number; topP95: number; claimP95: number | null; redP95: number | null; red: string; claim: string; safe: boolean; file: string | null; result: string };
const table: Row[] = [];
const contactRows: { label: string; file: string }[] = [];

for (const clipId of clipIds) {
  const c = await db.from("creative_lab_clips").select("id, artist_id, clip_no, creative_asset_id, crop_focus_y, crop_focus_x, in_s, out_s").eq("id", clipId).maybeSingle();
  if (c.error || !c.data) fail(`clip ${clipId}`);
  const clip = c.data!;
  const art = await db.from("creative_lab_artists").select("name").eq("id", clip.artist_id).maybeSingle();
  const artist = String(art.data?.name ?? "?");
  const asset = await db.from("creative_assets").select("storage_path").eq("id", clip.creative_asset_id).maybeSingle();
  if (asset.error || !asset.data) fail(`asset for ${clipId}`);
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

  // Name and details for this artist.
  const nameRec = kit.pieces.find((p) => p.role === "name" && p.artist === artist);
  if (!nameRec) fail(`no name piece for ${artist}`);
  const top = videoTopBlock({ lockup, name: await piece(nameRec!), info });

  for (const job of [
    { label: "a-general-sale-live", text: rung1.text, wm: rung1.wm, why: rung1.why },
    { label: "b-sample-roll-call", text: SAMPLE_ROLL_CALL, wm: WATERMARK.sample, why: "sample (fixture releases)" },
  ]) {
    const allowed = claimAllowed(full);
    const plan = allowed.ok ? await withWidths((m) => planVideoClaim(job.text, m, { releaseNames })) : null;
    const claimPlan = plan && !("held" in plan) ? (plan as VideoClaimPlan) : null;
    const claimRectM = claimPlan ? { left: (1080 - 840) / 2, top: claimPlan.blockTop, width: 840, height: claimPlan.bottom - claimPlan.blockTop } : null;
    const safe = insideVideoSafe([...top.all, ...(claimPlan ? claimPlan.lines.map((l) => ({ left: (1080 - l.widthPx) / 2, top: l.capTop, width: l.widthPx, height: l.capPx })) : [])]).ok;

    for (const fmt of FORMATS) {
      const t = typeTransform(fmt);
      const size = FORMAT_SIZE[fmt];
      const topRect = moveRect(top.block, t);
      const claimRect = claimRectM ? moveRect(claimRectM, t) : null;
      // O39: the crop. The clip's own crop_focus_y first, then 0.5, then ±0.1 outward.
      const own = Number(clip.crop_focus_y ?? 0.5);
      const cands = [...new Set([own, 0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8].map((v) => Math.round(v * 100) / 100))];
      const samplesFor = (cy: number): FaceSample[] => {
        const win = footageWindow(src, fmt, cy, Number(clip.crop_focus_x ?? 0.5));
        const k = size.width / win.width;
        return times.map((tS, i) => ({ tS, faces: (sourceFaces[i] ?? []).map((b) => ({ left: (b.left - win.left) * k, top: (b.top - win.top) * k, width: b.width * k, height: b.height * k })) }));
      };
      const pick = chooseCrop(cands, (cy) => judgeFaceOverTime(samplesFor(cy), { top: topRect, claim: claimRect }));
      const cropY = pick.crop ?? own;
      const v = pick.verdict;

      // O40: contrast per sample on the chosen crop, bands on, before type.
      const win = footageWindow(src, fmt, cropY, Number(clip.crop_focus_x ?? 0.5));
      const cs: ContrastSample[] = [];
      for (let i = 0; i < frames.length; i += 1) {
        const shown = await sharp(join(sdir, frames[i]!)).extract({ left: Math.round(win.left), top: Math.round(win.top), width: Math.round(win.width), height: Math.round(win.height) }).resize(size.width, size.height).composite([{ input: BANDS[fmt] }]).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const l1 = claimPlan?.lines[0];
        const redLine = claimPlan && l1 && l1.color === "red" ? redLineVerdict(shown.data, shown.info.width, shown.info.channels, { capTop: l1.capTop * t.k + t.dy, capPx: l1.capPx * t.k, widthPx: l1.widthPx * t.k }, size).share : null;
        cs.push({ tS: times[i]!, topBlock: lowContrastShare(shown.data, shown.info.width, shown.info.channels, topRect), claimBox: claimRect ? lowContrastShare(shown.data, shown.info.width, shown.info.channels, claimRect) : null, redInk: redLine });
      }
      const cv = judgeContrastOverClip(cs);

      // Type layers: the top block with the draft stamp (on from frame 0), the claim (in at 1.5 s, O37).
      const namePiece = await piece(nameRec!);
      const topPieces: Piece[] = [];
      const topPlaces: Placement[] = [];
      const list: [Piece | null, Placement | null][] = [[lockup, top.lockup], [namePiece, top.name], ...info.map((p, i) => [p, top.info[i] ?? null] as [Piece, Placement | null])];
      for (const [pc, pl] of list) {
        if (pc && pl) {
          topPieces.push(pc);
          topPlaces.push(pl);
        }
      }
      const typeTop = await layer({ pieces: topPieces, places: topPlaces }, fmt);
      const claimPieces: Piece[] = [];
      const claimPlaces: Placement[] = [];
      if (claimPlan) {
        for (const [i, line] of claimPlan.lines.entries()) {
          // O40: the red line is decided once for the clip; failing, line 1 is white throughout.
          const colour = line.color === "red" && (i > 0 || cv.red) ? KIT_RED : KIT_WHITE;
          const s = await renderCardLine(line.text, colour, line.capPx, face);
          claimPieces.push({ png: s.png, width: s.width, height: s.height, capPx: line.capPx, label: line.text });
          claimPlaces.push({ label: line.text, left: Math.round((1080 - s.width) / 2), top: Math.round(line.capTop - s.capTopRow), width: s.width, height: s.height, scale: 1, short: false, stepped: false, belowFloor: false });
        }
      }
      const typeClaim = claimPieces.length ? await layer({ pieces: claimPieces, places: claimPlaces }, fmt) : null;
      // O36: the stamp in a free corner of the 4:5 rectangle (every format shows it).
      const avoid = [...topPlaces, ...claimPlaces].map((p) => moveRect(p, t));
      const within = fmt === "9:16" ? { left: 0, top: 285, width: 1080, height: 1350 } : { left: 0, top: 0, width: size.width, height: size.height };
      const stamp = job.wm ? await watermarkLayer(job.wm, size, face.path, face.family ?? "Bootzy Condensed TM", { avoid, within }) : null;
      const topWithStamp = stamp ? await sharp(typeTop).composite([{ input: stamp }]).png().toBuffer() : typeTop;

      const id = `${slug}_${job.label}_${fmt.replace(":", "x")}`;
      writeFileSync(join(work, `${id}-top.png`), topWithStamp);
      writeFileSync(join(work, `${id}-bands.png`), BANDS[fmt]);
      if (typeClaim) writeFileSync(join(work, `${id}-claim.png`), typeClaim);
      const clipSigned = onLambda ? (await db.storage.from("campaign-assets").createSignedUrl(String(asset.data!.storage_path), 3600)).data?.signedUrl : null;
      const props: T1OnClipProps = {
        clipUrl: onLambda ? clipSigned! : `${base}/${clipFile}`,
        format: fmt,
        sourceWidth: src.width,
        sourceHeight: src.height,
        cropFocusY: cropY,
        cropFocusX: Number(clip.crop_focus_x ?? 0.5),
        inS,
        fps,
        durationInSeconds: dur,
        muted: true,
        bandsUrl: onLambda ? dataUri(BANDS[fmt]) : `${base}/${id}-bands.png`,
        topUrl: onLambda ? dataUri(topWithStamp) : `${base}/${id}-top.png`,
        claimUrl: typeClaim ? (onLambda ? dataUri(typeClaim) : `${base}/${id}-claim.png`) : null,
      };
      const refused = pick.crop == null ? v.line : null;
      // A refused clip is still drawn, as the flagged preview (stamped, never filed), so the refusal can be seen.
      const out = join(outDir, `${id}_DRAFT${refused ? "_REFUSED" : ""}.mp4`);
      // A draft carries its stamp, so the export guard refuses it; an unstamped draft would be exportable.
      if (!job.wm) fail(`${id}: an unstamped card would be exportable; drafts only`);
      try {
        assertExportable({ watermark: job.wm });
        fail(`${id}: the export guard let a stamped draft through`);
      } catch (e) {
        if ((e as Error).name !== "NotExportableError") throw e;
      }
      if (lambda) {
        const frames = Math.round(dur * fps);
        const chunk = lambdaChunking(lambda.limit, frames);
        const started = Date.now();
        const r = await renderMediaOnLambda({ region: REMOTION_REGION, functionName: lambda.functionName, serveUrl: lambda.serveUrl, composition: "T1OnClip", inputProps: props as unknown as Record<string, unknown>, codec: "h264", crf: 18, muted: true, framesPerLambda: chunk.framesPerLambda, concurrencyPerLambda: chunk.concurrencyPerLambda, privacy: "private", downloadBehavior: { type: "download", fileName: null } });
        let progress = await getRenderProgress({ renderId: r.renderId, bucketName: r.bucketName, functionName: lambda.functionName, region: REMOTION_REGION });
        while (!progress.done && !progress.fatalErrorEncountered) {
          await new Promise((res) => setTimeout(res, 2000));
          progress = await getRenderProgress({ renderId: r.renderId, bucketName: r.bucketName, functionName: lambda.functionName, region: REMOTION_REGION });
        }
        if (progress.fatalErrorEncountered || !progress.outKey) fail(`${id}: Lambda render failed: ${progress.errors.map((e) => e.message).join("; ")}`);
        const { GetObjectCommand } = await import("@aws-sdk/client-s3");
        const { LambdaClientInternals } = await import("@remotion/lambda/client");
        const s3 = LambdaClientInternals.getS3Client({ region: REMOTION_REGION, customCredentials: null, forcePathStyle: false, requestHandler: null });
        const obj = await s3.send(new GetObjectCommand({ Bucket: r.bucketName, Key: progress.outKey! }));
        writeFileSync(out, Buffer.from(await obj.Body!.transformToByteArray()));
        await deleteRender({ bucketName: r.bucketName, region: REMOTION_REGION, renderId: r.renderId });
        const functions = Math.ceil(frames / (chunk.framesPerLambda ?? frames)) + 1;
        lambdaCosts.push({ id, functions, costUsd: progress.costs?.accruedSoFar ?? null, ms: Date.now() - started });
        console.log(`  lambda: ${functions} functions · $${(progress.costs?.accruedSoFar ?? 0).toFixed(4)} · ${((Date.now() - started) / 1000).toFixed(0)} s`);
      } else {
        const composition = await selectComposition({ serveUrl, id: "T1OnClip", inputProps: props as unknown as Record<string, unknown> });
        await renderMedia({ composition, serveUrl, codec: "h264", crf: 18, outputLocation: out, inputProps: props as unknown as Record<string, unknown>, muted: true, logLevel: "error" });
      }
      contactRows.push({ label: `${id}${refused ? " · REFUSED (flagged preview)" : ""}`, file: out });
      console.log(`${id}: crop ${cropY} · face ${v.ok ? "ok" : v.line} · top p95 ${(cv.topBlockP95 * 100).toFixed(1)} % · claim p95 ${cv.claimBoxP95 == null ? "–" : (cv.claimBoxP95 * 100).toFixed(1) + " %"} · red ${cv.redInkP95 == null ? "–" : (cv.redInkP95 * 100).toFixed(1) + " %"} → ${cv.redInkP95 == null ? "–" : cv.red ? "red" : "white"}`);
      table.push({
        clip: clipId.slice(0, 8),
        artist,
        claimLabel: job.label,
        fmt,
        crop: pick.crop,
        faceLine: v.ok ? "ok" : (v.line ?? "refused"),
        topShare: v.topShare,
        claimShare: v.claimShare,
        runS: v.longestRunS,
        topP95: cv.topBlockP95,
        claimP95: cv.claimBoxP95,
        redP95: cv.redInkP95,
        red: cv.redInkP95 == null ? "–" : cv.red ? "red" : "white (whole clip)",
        claim: !allowed.ok ? allowed.line : claimPlan ? `step ${claimPlan.step}${claimPlan.dropped.length ? ` · dropped ${claimPlan.dropped.join(", ")}` : ""} · ${Math.round(claimPlan.widest)} of 840 px` : (plan as { held: string }).held,
        safe,
        file: `${id}_DRAFT${refused ? "_REFUSED" : ""}.mp4`,
        result: refused ? `refused: ${refused}` : [v.ok ? null : "face", cv.ok ? null : "contrast"].filter(Boolean).join(", ") || "passes",
      });
    }
  }
}

// ─── O46 on the encoded file: a flat mid-grey test clip through the composition (local) ─
const greyFile = "grey-test.mp4";
await sharp({ create: { width: 1080, height: 1920, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toFile(join(work, "grey.png"));
ff("ffmpeg", ["-y", "-v", "error", "-loop", "1", "-framerate", "30", "-i", join(work, "grey.png"), "-t", "2", "-c:v", "libx264", "-crf", "0", "-pix_fmt", "yuv444p", join(work, greyFile)]);
writeFileSync(join(work, "grey-bands.png"), BANDS["9:16"]);
writeFileSync(join(work, "grey-top.png"), await transparent("9:16"));
const greyProps: T1OnClipProps = { clipUrl: `${base}/${greyFile}`, format: "9:16", sourceWidth: 1080, sourceHeight: 1920, cropFocusY: 0.5, fps: 30, durationInSeconds: 2, muted: true, bandsUrl: `${base}/grey-bands.png`, topUrl: `${base}/grey-top.png`, claimUrl: null };
const greyOut = join(outDir, "grey-test_bands_crf18.mp4");
const greyComp = await selectComposition({ serveUrl, id: "T1OnClip", inputProps: greyProps as unknown as Record<string, unknown> });
await renderMedia({ composition: greyComp, serveUrl, codec: "h264", crf: 18, outputLocation: greyOut, inputProps: greyProps as unknown as Record<string, unknown>, muted: true, logLevel: "error" });
ff("ffmpeg", ["-y", "-v", "error", "-ss", "1", "-i", greyOut, "-frames:v", "1", join(work, "grey-frame.png")]);
const gf = await sharp(join(work, "grey-frame.png")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const means = rowMeanLuma(gf.data, gf.info.width, gf.info.height, gf.info.channels);
const steps = Array.from(means, (m, y) => (y ? Math.abs(m - means[y - 1]!) : 0));
const kneeNear = (y: number) => BAND_KNEE_ROWS_916.some((k) => Math.abs(k - y) <= 1);
const fadeMax = Math.max(...steps.filter((_, y) => !kneeNear(y)));
const kneeSteps = BAND_KNEE_ROWS_916.map((k) => Math.max(steps[k - 1] ?? 0, steps[k]!, steps[k + 1] ?? 0));

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
L.push(`ticket_warnings, read live (select only): ${rows.map((r) => `${r.id.slice(0, 8)} "${r.claim}" ${r.state}`).join(" · ")}. Claim (a): ${rung1.why}. Claim (b): the sample roll-call (fixture releases).`);
L.push(`Release names for the break rule (event_releases, select only): ${releaseNames.join(" · ") || "none"}.`);
L.push(onLambda
  ? `Kit face: provided by Puzzle (cleared, O49; recorded in kit-faces.ts, O51), fetched for this run from the private kit-fonts bucket through a one-hour signed URL, its PostScript name checked, then set by sharp from a temporary file (O52). Lambda received the clip as a signed URL and the type and bands as images in the props; its site (${DRAFT_SITE}) carries no kit font.`
  : `Kit face: provided by Puzzle (cleared, O49), read in place from FONTS_DIR, never copied or committed. Local Remotion renders.`);
if (lambdaCosts.length) {
  const total = lambdaCosts.reduce((a, c) => a + (c.costUsd ?? 0), 0);
  L.push(`Lambda: ${lambdaCosts.length} renders, ${lambdaCosts[0]!.functions} functions each (one orchestrator plus the chunks), $${(total / lambdaCosts.length).toFixed(4)} a render on average, $${total.toFixed(4)} in all.`);
}
L.push(`Each clip: its first ${seconds} s from in_s, muted, H.264 CRF 18. Samples at ${T1V_FACE.fps} a second.`, "");
L.push("| Clip | Claim | Format | Crop (crop_focus_y) | Face: top / claim share · longest run | Top block p95 (≤ 10 %) | Claim box p95 (≤ 15 %) | Red ink p95 (≤ 25 %) → colour | Claim | Inside safe area | Result | File |");
L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of table) L.push(`| ${r.artist} (${r.clip}) | ${r.claimLabel} | ${r.fmt} | ${r.crop ?? "none passes"} | ${pct(r.topShare)} / ${pct(r.claimShare)} · ${r.runS.toFixed(1)} s${r.faceLine === "ok" ? "" : ` · ${r.faceLine}`} | ${pct(r.topP95)} | ${pct(r.claimP95)} | ${pct(r.redP95)} → ${r.red} | ${r.claim} | ${r.safe ? "✓" : "✗"} | ${r.result} | ${r.file ?? "–"} |`);
L.push("", "## O46 on the encoded file");
L.push(`A flat 0x808080 1080 × 1920 clip through T1OnClip with the bands only, H.264 CRF 18 (grey-test_bands_crf18.mp4), frame at 1 s. Largest step between adjacent rows' mean luma across the fades: ${fadeMax.toFixed(2)} levels (limit ${MAX_ROW_STEP}) → ${fadeMax <= MAX_ROW_STEP ? "passes" : "fails"}. At J2's two knees (rows ${BAND_KNEE_ROWS_916.join(", ")}): ${kneeSteps.map((k) => k.toFixed(2)).join(" / ")} levels — the band's own drop inside one row, not a dither step.`);
L.push("", "## Invented while building (T1V_INVENTED)");
for (const i of T1V_INVENTED) L.push(`- ${i}`);
L.push("", `Contact sheet: CONTACT-SHEET.png (frames at ${TIMES.join(" / ")} s).`);
writeFileSync(join(outDir, "report.md"), L.join("\n") + "\n");
server.close();
if (lambda) await deleteSite({ bucketName: lambda.bucketName, region: REMOTION_REGION, siteName: DRAFT_SITE });
faceTmp?.done();
console.log(`wrote ${contactRows.length} drafts, CONTACT-SHEET.png and report.md to ${outDir}`);
