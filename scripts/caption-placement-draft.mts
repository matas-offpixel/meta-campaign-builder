/**
 * HP6-4. Enzo 1's line, forced to 0.85 and 0.65 at centre 912.9, through
 * CaptionOnClip on a temporary Lambda site. Stamped DRAFT, with C6's line.
 * No creative_lab_renders row, no Drive, no launch.
 *
 *   node --env-file=/Users/liebus/meta-campaign-builder/.env.local --experimental-strip-types scripts/caption-placement-draft.mts --out <dir>
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { deleteRender, deleteSite, deploySite, getFunctions, getOrCreateBucket, getRenderProgress, renderMediaOnLambda } from "@remotion/lambda";
import { LambdaClientInternals } from "@remotion/lambda/client";
import { createClient } from "@supabase/supabase-js";

import { placementLine } from "../lib/creative-lab/caption-placement.ts";
import { REMOTION_REGION, lambdaChunking, pickLambdaFunction, readConcurrencyLimit } from "../lib/creative-lab/lambda.ts";
import { audioMode } from "../lib/creative-lab/render.ts";
import { renderAssetId } from "../lib/creative-lab/render-proxy.ts";
import { clipWindow } from "../lib/creative-lab/surface.ts";
import { styleVersion } from "../src/remotion/caption-style/profile.ts";

const CLIP = "710f043d-cd37-419e-bd2a-6a1361ada7c3";
const CAPTION = "4d87a400-db33-47a1-a3e2-f3ab77e75abd";
const CENTRE = 912.9;
const SCALES = [0.85, 0.65] as const;

if (process.argv.some((arg) => ["--apply", "--export", "--upload", "--launch"].includes(arg))) {
  throw new Error("this draft does not write a render, Drive or a launch");
}
const outDir = resolve(process.argv[process.argv.indexOf("--out") + 1] ?? "");
if (!outDir || outDir === resolve("")) throw new Error("--out is required");
mkdirSync(outDir, { recursive: true });

const COMP = resolve("node_modules/@remotion/compositor-darwin-arm64");
const ff = (bin: string, args: string[]) => {
  const result = spawnSync(join(COMP, bin), args, { env: { ...process.env, DYLD_LIBRARY_PATH: COMP }, encoding: "utf8", maxBuffer: 1 << 26 });
  if (result.status !== 0) throw new Error(`${bin}: ${result.stderr?.slice(-300)}`);
  return result.stdout;
};

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const version = await styleVersion();
const { bucketName } = await getOrCreateBucket({ region: REMOTION_REGION });
const fn = pickLambdaFunction(await getFunctions({ region: REMOTION_REGION, compatibleOnly: true }));
if (!fn) throw new Error("no Remotion function in eu-west-2");
const limit = await readConcurrencyLimit();
const siteName = "caption-placement-draft";
const site = await deploySite({ entryPoint: resolve("src/remotion/index.tsx"), bucketName, region: REMOTION_REGION, siteName });
console.log(`site ${siteName} deployed`);
const s3 = LambdaClientInternals.getS3Client({ region: REMOTION_REGION, customCredentials: null, forcePathStyle: false, requestHandler: null });
const done: unknown[] = [];
try {
  const clip = (await db.from("creative_lab_clips").select("*").eq("id", CLIP).single()).data;
  const cap = (await db.from("creative_lab_captions").select("*").eq("id", CAPTION).single()).data;
  if (!clip || !cap) throw new Error("Enzo 1 clip or caption was not found");
  const source = (await db.from("creative_assets").select("storage_path, storage_bucket").eq("id", renderAssetId(clip)).single()).data;
  if (!source?.storage_path) throw new Error("clip has no source");
  const signed = (await db.storage.from(String(source.storage_bucket ?? "campaign-assets")).createSignedUrl(String(source.storage_path), 3600)).data?.signedUrl;
  if (!signed) throw new Error("no signed url");
  const probe = JSON.parse(ff("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", signed])) as {
    streams: { width: number; height: number; r_frame_rate: string }[];
    format: { duration: string };
  };
  const [fnum, fden] = probe.streams[0]!.r_frame_rate.split("/").map(Number);
  const fps = Math.round((fnum! / (fden || 1)) * 100) / 100;
  const fileS = Number(probe.format.duration);
  const window = clipWindow({ fileSeconds: fileS, inS: clip.in_s == null ? null : Number(clip.in_s), outS: clip.out_s == null ? null : Number(clip.out_s) });
  const outS = Math.min(fileS, window.outS ?? fileS);
  const lines = (cap.lines as string[]).map((line) => line.trim()).filter(Boolean);
  for (const scale of SCALES) {
    const note = placementLine(6, scale, 1)!;
    const name = `HP6-4-enzo-1_${Math.round(scale * 100)}_at_912.9_DRAFT.mp4`;
    const props = {
      clipUrl: signed,
      lines,
      styleVersion: version,
      aspect: "9:16" as const,
      inS: 0,
      outS,
      audio: audioMode(String(clip.audio_status ?? "original")),
      cropFocusY: clip.crop_focus_y == null ? 0.5 : Number(clip.crop_focus_y),
      cropFocusX: clip.crop_focus_x == null ? 0.5 : Number(clip.crop_focus_x),
      sourceWidth: probe.streams[0]!.width,
      sourceHeight: probe.streams[0]!.height,
      fps,
      durationInSeconds: fileS,
      plate: "video" as const,
      size: cap.size_variant === "long" ? "long" as const : "default" as const,
      placementCenterY: CENTRE,
      placementScale: scale,
      draftStamp: "DRAFT",
      draftNote: note,
    };
    const frames = Math.max(1, Math.round((outS - 0) * fps));
    const chunk = lambdaChunking(limit, frames);
    const started = Date.now();
    const rendered = await renderMediaOnLambda({
      region: REMOTION_REGION,
      functionName: fn.functionName,
      serveUrl: site.serveUrl,
      composition: "CaptionOnClip",
      inputProps: props as unknown as Record<string, unknown>,
      codec: "h264",
      privacy: "private",
      imageFormat: "jpeg",
      maxRetries: 1,
      muted: props.audio === "muted",
      framesPerLambda: chunk.framesPerLambda,
      concurrencyPerLambda: chunk.concurrencyPerLambda,
    });
    let progress = await getRenderProgress({ region: REMOTION_REGION, functionName: fn.functionName, bucketName: rendered.bucketName, renderId: rendered.renderId });
    while (!progress.done && !progress.fatalErrorEncountered) {
      await new Promise((res) => setTimeout(res, 1500));
      progress = await getRenderProgress({ region: REMOTION_REGION, functionName: fn.functionName, bucketName: rendered.bucketName, renderId: rendered.renderId });
    }
    if (progress.fatalErrorEncountered || !progress.outKey) {
      await deleteRender({ region: REMOTION_REGION, bucketName: rendered.bucketName, renderId: rendered.renderId });
      throw new Error(`${name}: ${progress.errors.map((error) => error.message.split("\n")[0]).join("; ")}`);
    }
    const obj = await s3.send(new GetObjectCommand({ Bucket: rendered.bucketName, Key: progress.outKey }));
    const bytes = Buffer.from(await obj.Body!.transformToByteArray());
    await deleteRender({ region: REMOTION_REGION, bucketName: rendered.bucketName, renderId: rendered.renderId });
    const file = join(outDir, name);
    writeFileSync(file, bytes);
    const stills: string[] = [];
    for (const t of [0.5, 4]) {
      const still = file.replace(/\.mp4$/, `_${t}s.png`);
      ff("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", still]);
      stills.push(still);
    }
    done.push({ name, note, centre: CENTRE, scale, stills, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), ms: Date.now() - started });
    console.log(`${name} · ${note}`);
  }
} finally {
  await deleteSite({ bucketName, region: REMOTION_REGION, siteName });
  console.log(`site ${siteName} deleted`);
  writeFileSync(join(outDir, "rendered.json"), JSON.stringify(done, null, 1));
}
