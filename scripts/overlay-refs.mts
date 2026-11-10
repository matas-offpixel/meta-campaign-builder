/**
 * Measure reference overlay PSDs: every gradient shadow layer (gradient fill,
 * painted pixel layer, solid fill with a gradient mask, or a Gradient Overlay
 * effect) and every CTA / roll-call text piece. Reads only: Drive downloads go
 * to --cache, results to --out. Nothing is written to Drive or Storage.
 *
 *   node --max-old-space-size=12288 --env-file=.env.local --experimental-strip-types scripts/overlay-refs.mts \
 *     --file 1TAfwaYC5JfxpOpcX8a74bhc-Q_o4szT1 --file … [--cache outputs/overlay-refs/src] [--out outputs/overlay-refs]
 *
 * Positions are fractions of the canvas (H vertical, W horizontal), so they
 * hold at 1080×1920; px figures are given at 1080×1920 too.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Layer, Psd } from "ag-psd";
import sharp from "sharp";

import { hex } from "../lib/creative-lab/colour.ts";
import { effectiveAlpha, gradientDirection, gradientStops, profiles, summarizeProfile, type ProfileSummary } from "../lib/creative-lab/overlay-gradient.ts";
import { fontsDir, indexFonts, resolveFont } from "../lib/creative-lab/kit-font.ts";
import { inkBox, layerKind, loadAgPsd, READ_OPTIONS, walkLayers } from "../lib/creative-lab/psd-kit.ts";
import { loadExportServiceAccount, signDriveJwt } from "../lib/drive/client.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const fileIds = argv.flatMap((a, i) => (a === "--file" && argv[i + 1] ? [argv[i + 1]!] : []));
const cacheDir = flag("--cache") ?? join("outputs", "overlay-refs", "src");
const outDir = flag("--out") ?? join("outputs", "overlay-refs");
if (!fileIds.length) {
  console.error("--file DRIVE_ID is required (repeatable)");
  process.exit(2);
}
mkdirSync(cacheDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

async function driveToken(): Promise<string> {
  const sa = loadExportServiceAccount(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON);
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signDriveJwt(sa) }).toString(),
  });
  const token = ((await res.json()) as { access_token?: string }).access_token;
  if (!res.ok || !token) throw new Error(`Drive token request failed (HTTP ${res.status})`);
  return token;
}

/** Read-only: metadata, then the bytes streamed to the cache (skipped when the cached size matches). */
async function fetchPsd(token: string, id: string): Promise<{ name: string; path: string }> {
  const meta = (await (await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,size&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { name?: string; size?: string };
  if (!meta.name) throw new Error(`Drive file ${id}: no metadata (shared with the export service account?)`);
  const path = join(cacheDir, meta.name);
  if (!(existsSync(path) && statSync(path).size === Number(meta.size))) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok || !res.body) throw new Error(`Drive download ${meta.name}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(`${path}.part`));
    renameSync(`${path}.part`, path);
  }
  return { name: meta.name, path };
}

type GradientRow = {
  psd: string;
  ref: string;
  layer: string;
  shown: boolean;
  construction: string;
  blendMode: string;
  opacity: number;
  fillOpacity: number | null;
  color: string | null;
  direction: "vertical" | "horizontal" | "flat";
  /** The profile along the varying axis (fractions of H for vertical, W for horizontal). */
  profile: ProfileSummary;
  /** The other axis: how far the shadow reaches across. */
  across: { start: number; end: number };
  stops: { position: number; color: string; opacity: number }[];
};

type TextRow = {
  psd: string;
  ref: string;
  group: string;
  text: string;
  shown: boolean;
  font: string | null;
  sizePx1080: number | null;
  colors: string[];
  inkTop: number | null;
  inkBottom: number | null;
  inkHeightPx1080: number | null;
  lines: number;
};

const rgb = (c: { r: number; g: number; b: number } | undefined) => (c ? hex([c.r, c.g, c.b]) : null);

const { readPsd } = await loadAgPsd();
const token = await driveToken();
const gradients: GradientRow[] = [];
const texts: TextRow[] = [];
const notes: string[] = [];
const fontsNamed = new Map<string, Set<string>>();

for (const id of fileIds) {
  const { name, path } = await fetchPsd(token, id);
  const buf = readFileSync(path);
  const psd: Psd = readPsd(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), READ_OPTIONS);
  const W = psd.width;
  const H = psd.height;
  const k1080 = 1080 / W;
  const slug = name.replace(/\.psd$/i, "").replace(/[^A-Za-z0-9]+/g, "-");
  if (psd.imageData) await sharp(Buffer.from(psd.imageData.data.buffer), { raw: { width: W, height: H, channels: 4 } }).resize(1080, 1920, { fit: "fill" }).png().toFile(join(outDir, `${slug}-composite.png`));
  const walked = walkLayers(psd.children);
  let found = 0;
  for (const w of walked) {
    const l: Layer = w.layer;
    const kind = layerKind(l);
    const gradOverlay = l.effects?.gradientOverlay?.filter((e) => e.enabled !== false && (e as { present?: boolean }).present !== false) ?? [];
    const vf = l.vectorFill as { type?: string; color?: { r: number; g: number; b: number }; colorStops?: never; opacityStops?: never } | undefined;
    const isGradFill = vf?.type === "gradient";
    const masked = !!(l.mask && !l.mask.disabled && l.mask.imageData);
    const b = { left: l.left ?? 0, top: l.top ?? 0, right: l.right ?? 0, bottom: l.bottom ?? 0 };
    const big = b.right - b.left >= 0.5 * W && b.bottom - b.top >= 0.2 * H;
    if (!(gradOverlay.length || isGradFill || ((kind === "fill" || kind === "pixel") && big))) continue;
    const pixels = l.imageData && kind !== "fill" ? { width: l.imageData.width, height: l.imageData.height, data: l.imageData.data } : null;
    const mask = masked ? { left: l.mask!.left ?? 0, top: l.mask!.top ?? 0, width: l.mask!.imageData!.width, height: l.mask!.imageData!.height, data: Uint8Array.from({ length: l.mask!.imageData!.width * l.mask!.imageData!.height }, (_, i) => l.mask!.imageData!.data[i * 4]!), defaultColor: l.mask!.defaultColor ?? 0 } : null;
    const map = effectiveAlpha({ canvas: { width: W, height: H }, bounds: b, pixels, mask, opacity: l.opacity ?? 1, fillOpacity: l.fillOpacity ?? 1 });
    const pr = profiles(map);
    const direction = gradientDirection(pr);
    const along = direction === "horizontal" ? pr.cols : pr.rows;
    const acrossP = summarizeProfile(direction === "horizontal" ? pr.rows : pr.cols);
    const construction = isGradFill
      ? "gradient fill layer"
      : gradOverlay.length
        ? "Gradient Overlay layer effect"
        : kind === "fill" && masked
          ? `solid colour fill + gradient layer mask`
          : kind === "fill"
            ? "solid colour fill (no mask)"
            : masked
              ? "pixel layer + layer mask"
              : "pixel layer";
    const stops = isGradFill ? gradientStops(vf as never) : gradOverlay.length ? gradientStops(gradOverlay[0]!.gradient as never) : [];
    gradients.push({
      psd: name,
      ref: w.ref,
      layer: l.name ?? "",
      shown: w.parentShown && !w.layer.hidden,
      construction,
      blendMode: gradOverlay[0]?.blendMode ?? l.blendMode ?? "normal",
      opacity: l.opacity ?? 1,
      fillOpacity: l.fillOpacity ?? null,
      color: vf?.type === "color" ? rgb(vf.color) : null,
      direction,
      profile: summarizeProfile(along),
      across: { start: acrossP.start, end: acrossP.end },
      stops,
    });
    found += 1;
    // A preview of the layer's alpha on white, at 1080×1920.
    const grey = Buffer.from(Uint8Array.from(map.alpha, (v) => 255 - Math.round(Math.min(1, v) * 255)));
    await sharp(grey, { raw: { width: W, height: H, channels: 1 } }).resize(1080, 1920, { fit: "fill" }).png().toFile(join(outDir, `${slug}-layer-${w.ref.replace(/\W/g, "_")}-alpha.png`));
  }
  if (!found) notes.push(`${name}: no gradient fill, gradient-masked fill, painted gradient or Gradient Overlay layer (${walked.length} layers read).`);
  for (const w of walked) {
    const l = w.layer;
    if (!l.text) continue;
    const runs = l.text.styleRuns?.length ? l.text.styleRuns.map((r) => r.style) : [l.text.style ?? {}];
    for (const s of [l.text.style, ...runs]) {
      const fname = s?.font?.name;
      if (fname) (fontsNamed.get(fname) ?? fontsNamed.set(fname, new Set()).get(fname)!).add(name);
    }
    const colors = [...new Set(runs.map((s) => rgb(s?.fillColor as never)).filter((c): c is string => !!c))];
    const scale = l.text.transform ? Math.hypot(l.text.transform[2]!, l.text.transform[3]!) : 1;
    const size = l.text.style?.fontSize ?? runs[0]?.fontSize ?? null;
    const ink = l.imageData ? inkBox(l.imageData) : null;
    texts.push({
      psd: name,
      ref: w.ref,
      group: w.path?.join(" / ") ?? "",
      text: l.text.text.replace(/\s+/g, " ").trim(),
      shown: w.parentShown && !w.layer.hidden,
      font: l.text.style?.font?.name ?? null,
      sizePx1080: size != null ? size * scale * k1080 : null,
      colors,
      inkTop: ink ? ((l.top ?? 0) + ink.top) / H : null,
      inkBottom: ink ? ((l.top ?? 0) + ink.bottom) / H : null,
      inkHeightPx1080: ink ? (ink.bottom - ink.top) * k1080 : null,
      lines: l.text.text.split(/\r|\n/).filter((s) => s.trim()).length,
    });
  }
}

// Fonts the PSDs name, against the installed folder (read in place; nothing copied).
const fontIndex = indexFonts(fontsDir());
const fonts = [...fontsNamed.entries()].map(([font, psds]) => {
  const r = resolveFont(font, fontIndex);
  return { font, psds: [...psds], status: r.status, file: r.status === "missing" ? null : r.entry.file, message: r.status === "found" ? null : r.message };
});
writeFileSync(join(outDir, "measurements.json"), JSON.stringify({ gradients, texts, notes, fontsDir: fontsDir(), fontsIndexed: fontIndex.length, fonts }, null, 2));
const f = (v: number | null | undefined, d = 3) => (v == null ? "–" : v.toFixed(d));
const lines = [
  "## Gradient layers",
  "| psd | layer | shown | construction | colour | opacity · fill | blend | direction | start → end | max (at) | 90 / 50 / 10 % of max at | across | alpha at 0,10…100 % |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...gradients.map((g) => `| ${g.psd} | ${g.ref} ${g.layer} | ${g.shown ? "yes" : "no"} | ${g.construction} | ${g.color ?? (g.stops.length ? g.stops.map((s) => `${s.color}@${f(s.position, 2)}·${f(s.opacity, 2)}`).join(" → ") : "–")} | ${f(g.opacity, 3)} · ${g.fillOpacity == null ? "–" : f(g.fillOpacity, 3)} | ${g.blendMode} | ${g.direction} | ${f(g.profile.start)} → ${f(g.profile.end)} | ${f(g.profile.max)} (${f(g.profile.maxAt)}) | ${f(g.profile.fall.p90)} / ${f(g.profile.fall.p50)} / ${f(g.profile.fall.p10)} | ${f(g.across.start)} → ${f(g.across.end)} | ${g.profile.samples.map((v) => f(v, 2)).join(" ")} |`),
  "",
  ...notes.map((n) => `- ${n}`),
  "",
  `## Fonts named in the PSDs, against ${fontsDir()} (${fontIndex.length} faces indexed)`,
  "| font | named in | status | installed file | hold |",
  "|---|---|---|---|---|",
  ...fonts.map((x) => `| ${x.font} | ${x.psds.join(", ")} | ${x.status} | ${x.file ?? "–"} | ${x.message ?? "–"} |`),
  "",
  "## Text pieces",
  "| psd | ref | group | shown | text | font | size px @1080 | ink top–bottom (H) | ink h px @1080 | lines | colours |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...texts.map((t) => `| ${t.psd} | ${t.ref} | ${t.group} | ${t.shown ? "yes" : "no"} | ${t.text.slice(0, 60)} | ${t.font ?? "–"} | ${f(t.sizePx1080, 1)} | ${f(t.inkTop, 4)}–${f(t.inkBottom, 4)} | ${f(t.inkHeightPx1080, 1)} | ${t.lines} | ${t.colors.join(", ")} |`),
];
writeFileSync(join(outDir, "measurements.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
