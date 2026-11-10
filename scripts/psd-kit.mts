/**
 * Read an event's artwork open files (PSD / PSB in its Drive "01 Open files")
 * and write the kit: a layer manifest, a flattened preview, one PNG per shown
 * layer (smart-object contents included when the file embeds them), and the
 * pieces the artist card reuses (one PNG per line of the headliner-names text
 * layer, the info lines, the logo, the title).
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/psd-kit.mts --event P26-BDAY
 *   node --env-file=.env.local --experimental-strip-types scripts/psd-kit.mts --event P26-BDAY --psd 'PUZZLE BIRTHDAY 1 STORY.psd' --apply
 *
 * The PSDs are hundreds of MB, so each is streamed to --cache (default
 * outputs/{CODE}/src/) and read from there; a cached file of the same size is
 * not downloaded again. Run with --max-old-space-size=8192: ag-psd holds every
 * layer's pixels.
 *
 * Default: reads Drive and Supabase only, writes the kit to --out (default
 * outputs/{CODE}/kits/{psd slug}/). --apply also stores every file under
 * campaign-assets kits/{eventId}/{psd slug}/ and copies the preview into the
 * event's 01 Open files (tagged, so the Drive pickup skips it; an existing
 * name gets _v2, _v3 — nothing is overwritten or deleted). No Lab table,
 * round or Meta call is touched.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { createClient } from "@supabase/supabase-js";
import type { Layer, Psd } from "ag-psd";
import sharp from "sharp";

import { uploadToStorageBucket } from "../lib/clients/asset-queue/storage-upload.ts";
import { APP_ID_KEY, APP_TAG_KEY, driveFromEnv, loadExportServiceAccount, signDriveJwt, type DriveApi } from "../lib/drive/client.ts";
import {
  allLayers,
  buildManifest,
  cropPixels,
  identifyRoles,
  inkBox,
  kitPrefix,
  kitSlug,
  layerFileName,
  lineRole,
  loadAgPsd,
  normalizeWords,
  READ_OPTIONS,
  rgba8,
  splitTextLines,
  walkLayers,
  type KitLayer,
  type KitManifest,
  type RoleHit,
} from "../lib/creative-lab/psd-kit.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const apply = argv.includes("--apply");
const code = flag("--event")?.trim() ?? "";
/** --role logo=0 --role title=0 --role panel=3: a role read by eye, when layer names and text can't tell. */
const roleOverrides = argv.flatMap((arg, i) => (arg === "--role" && argv[i + 1] ? [argv[i + 1]!] : [])).map((pair) => {
  const [role, ref] = pair.split("=");
  return { role: role!.trim() as RoleHit["role"], ref: (ref ?? "").trim() };
});
const only = argv.flatMap((arg, i) => (arg === "--psd" && argv[i + 1] ? [argv[i + 1]!] : []));
const outRoot = flag("--out") ?? join("outputs", code, "kits");
const cacheDir = flag("--cache") ?? join("outputs", code, "src");

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}
if (!code) fail("--event CODE is required");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const supabase = createClient(url, key, { auth: { persistSession: false } });
const { drive, reason } = driveFromEnv();
if (!drive) fail(`The export drive is needed to read the open files: ${reason}`);

// ─── Event facts ────────────────────────────────────────────────────────────

const eventRes = await supabase.from("events").select("id, name, client_id, event_code, venue_name, venue_city, event_date").eq("event_code", code).maybeSingle();
if (eventRes.error) fail(eventRes.error.message);
const event = eventRes.data;
if (!event) fail(`No event ${code}`);
const lineupRes = await supabase.from("event_artists").select("artist_id, is_headliner, billing_order").eq("event_id", event.id).order("billing_order").range(0, 999);
if (lineupRes.error) fail(lineupRes.error.message);
const libraryIds = (lineupRes.data ?? []).map((r) => String(r.artist_id));
const artistsRes = libraryIds.length ? await supabase.from("artists").select("id, name").in("id", libraryIds).range(0, 999) : { data: [], error: null };
if (artistsRes.error) fail(artistsRes.error.message);
const nameById = new Map((artistsRes.data ?? []).map((a) => [String(a.id), String(a.name)]));
const headliners = (lineupRes.data ?? []).filter((r) => r.is_headliner).map((r) => nameById.get(String(r.artist_id)) ?? "").filter(Boolean);
const lineup = (lineupRes.data ?? []).map((r) => nameById.get(String(r.artist_id)) ?? "").filter(Boolean);
const facts = { headliners, venue: event.venue_name, city: event.venue_city, date: event.event_date };

const folderRes = await supabase.from("drive_folders").select("drive_folder_id").eq("event_id", event.id).eq("key", "01").maybeSingle();
if (folderRes.error) fail(folderRes.error.message);
const openFiles = folderRes.data?.drive_folder_id;
if (!openFiles) fail(`${code} has no 01 Open files folder in drive_folders — run scripts/backfill-drive-tree.mts --event ${code} first`);

const files = (await drive.listChildren(openFiles)).filter((f) => /\.(psd|psb)$/i.test(f.name) && !f.trashed && (!only.length || only.includes(f.name)));
console.log(`# PSD kit ${apply ? "APPLY" : "LOCAL"} · ${code} · ${event.name}`);
console.log(`Headliners: ${headliners.join(", ") || "none"} · lineup ${lineup.length} · ${event.venue_name ?? "?"}, ${event.venue_city ?? "?"} · ${event.event_date ?? "?"}`);
console.log(`01 Open files ${openFiles}: ${files.length} PSD/PSB${only.length ? ` (asked for ${only.join(", ")})` : ""}\n`);
if (!files.length) fail("Nothing to read. Copy the open files into the event's 01 Open files first.");

// ─── One PSD ────────────────────────────────────────────────────────────────

const { readPsd } = await loadAgPsd();

function isPsdBytes(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0x38 && data[1] === 0x42 && data[2] === 0x50 && data[3] === 0x53; // "8BPS"
}

/** Smart objects whose embedded file is itself a PSD / PSB, read once each. */
const nestedPsds = new Map<string, Psd>();
function readNested(file: { id: string; name: string; data: Uint8Array }): Psd | null {
  if (!isPsdBytes(file.data)) return null;
  const cached = nestedPsds.get(file.id);
  if (cached) return cached;
  const psd = readPsd(file.data, READ_OPTIONS);
  nestedPsds.set(file.id, psd);
  return psd;
}

/** The ag-psd layer behind a manifest ref, smart-object refs ("3>1") included. */
function resolveLayer(psd: Psd, ref: string): { layer: Layer; offset: { x: number; y: number } } | null {
  const [outer, ...inner] = ref.split(">");
  const walked = walkLayers(psd.children);
  const top = walked.find((w) => w.ref === outer)?.layer;
  if (!top) return null;
  if (!inner.length) return { layer: top, offset: { x: 0, y: 0 } };
  const linked = psd.linkedFiles?.find((f) => f.id === top.placedLayer?.id);
  const nested = linked ? nestedPsds.get(linked.id) : undefined;
  if (!nested) return null;
  const found = resolveLayer(nested, inner.join(">"));
  return found ? { layer: found.layer, offset: found.offset } : null;
}

async function pngOf(layer: Layer): Promise<Buffer | null> {
  const px = layer.imageData;
  if (!px || !px.width || !px.height) return null;
  return sharp(Buffer.from(rgba8(px)), { raw: { width: px.width, height: px.height, channels: 4 } }).png().toBuffer();
}

type PieceRecord = {
  role: "name" | "info" | "logo" | "title" | "lineup_heading" | "lineup_other";
  label: string;
  artist: string | null;
  file: string;
  width: number;
  height: number;
  cap_px: number;
  source_ref: string;
  /** Canvas position of the piece's ink box in the PSD. */
  canvas: { left: number; top: number };
};

const report: string[] = [];
const say = (line = "") => {
  console.log(line);
  report.push(line);
};

const written: { path: string; bytes: Buffer; type: string }[] = [];
for (const file of files) {
  const slug = kitSlug(file.name);
  const outDir = join(outRoot, slug);
  const put = (rel: string, bytes: Buffer, type: string) => {
    const full = join(outDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
    written.push({ path: `${kitPrefix(event.id, file.name)}${rel}`, bytes, type });
  };
  written.length = 0;
  nestedPsds.clear();

  const started = Date.now();
  const bytes = await cachedDownload(file.id, file.name, file.size ?? null);
  const psd = readPsd(bytes, READ_OPTIONS);
  const manifest: KitManifest = buildManifest(psd, file.name, { readNested });
  const roles = identifyRoles(manifest, facts);
  for (const o of roleOverrides) {
    const layer = allLayers(manifest.layers).find((l) => l.ref === o.ref);
    if (!layer) fail(`--role ${o.role}=${o.ref}: no layer ${o.ref} in ${file.name}`);
    roles.push({ role: o.role, ref: o.ref, name: layer.name, why: "set by eye (--role)" });
  }

  // Preview: the file's own composite when it has one, else the shown layers flattened (normal blend only).
  let preview: Buffer;
  let previewNote: string;
  if (psd.imageData && manifest.has_composite) {
    preview = await sharp(Buffer.from(rgba8(psd.imageData)), { raw: { width: psd.width, height: psd.height, channels: 4 } }).png().toBuffer();
    previewNote = "the PSD's own composite (saved with maximise compatibility)";
  } else {
    const parts: { input: Buffer; left: number; top: number }[] = [];
    for (const { layer } of [...walkLayers(psd.children)].reverse()) {
      if (layer.hidden || layer.children || !layer.imageData) continue;
      const png = await pngOf(layer);
      if (png) parts.push({ input: png, left: layer.left ?? 0, top: layer.top ?? 0 });
    }
    preview = await sharp({ create: { width: psd.width, height: psd.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(parts).png().toBuffer();
    previewNote = "no composite in the file — flattened here from the shown layers, normal blend only (blend modes and effects not applied)";
  }
  put("preview.png", preview, "image/png");
  put("preview-1080.png", await sharp(preview).resize({ width: 1080 }).png().toBuffer(), "image/png");

  // One PNG per shown layer with pixels, nested ones included.
  const layerFiles = new Map<string, string>();
  for (const layer of allLayers(manifest.layers)) {
    if (!layer.shown || !layer.has_pixels) continue;
    const found = resolveLayer(psd, layer.ref);
    const png = found ? await pngOf(found.layer) : null;
    if (!png) continue;
    const rel = layerFileName(layer);
    put(rel, png, "image/png");
    layerFiles.set(layer.ref, rel);
  }

  // Pieces.
  const pieces: PieceRecord[] = [];
  const notes: string[] = [];
  const nameHit = roles.find((r) => r.role === "headliner_names");
  const nameLayer = nameHit ? allLayers(manifest.layers).find((l) => l.ref === nameHit.ref) : null;
  const nameSource = nameHit ? resolveLayer(psd, nameHit.ref) : null;
  if (nameLayer?.text && nameSource?.layer.imageData) {
    const split = splitTextLines(nameSource.layer.imageData, nameLayer.text.lines);
    if (!split) {
      notes.push(`names: the text has ${nameLayer.text.lines.length} lines but its pixels show a different number of ink bands — not split`);
    } else {
      for (const { line, band } of split) {
        const crop = cropPixels(nameSource.layer.imageData, { left: band.left, top: band.top, right: band.right, bottom: band.bottom });
        const png = await sharp(Buffer.from(rgba8(crop)), { raw: { width: crop.width, height: crop.height, channels: 4 } }).png().toBuffer();
        const words = normalizeWords(line);
        const kind = lineRole(line, lineup, facts);
        const artist = kind.artist;
        const role: PieceRecord["role"] = kind.role === "name" ? "name" : kind.role === "info" ? "info" : kind.role === "heading" ? "lineup_heading" : "lineup_other";
        const rel = `pieces/${role}-${words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`;
        put(rel, png, "image/png");
        pieces.push({
          role,
          label: line,
          artist,
          file: rel,
          width: crop.width,
          height: crop.height,
          cap_px: crop.height,
          source_ref: nameHit!.ref,
          canvas: { left: (nameSource.layer.left ?? 0) + band.left, top: (nameSource.layer.top ?? 0) + band.top },
        });
      }
    }
  }
  const extracted = new Set<string>();
  for (const hit of roles.filter((r) => r.role === "info" || r.role === "logo" || r.role === "title")) {
    if (extracted.has(hit.ref) || hit.ref === nameHit?.ref) continue;
    extracted.add(hit.ref);
    const sharedWith = roles.filter((r) => r.ref === hit.ref && r.role !== hit.role && (r.role === "logo" || r.role === "title")).map((r) => r.role);
    const found = resolveLayer(psd, hit.ref);
    const px = found?.layer.imageData;
    if (!px) {
      notes.push(`${hit.role} "${hit.name}" (${hit.ref}): no pixels of its own`);
      continue;
    }
    const kitLayer = allLayers(manifest.layers).find((l) => l.ref === hit.ref)!;
    const split = hit.role === "info" && kitLayer.text ? splitTextLines(px, kitLayer.text.lines) : null;
    const parts = split ?? [{ line: kitLayer.text?.content.replace(/\s+/g, " ").trim() || kitLayer.name, band: { ...(inkBox(px) ?? { left: 0, top: 0, right: px.width, bottom: px.height }) } }];
    for (const { line, band } of parts) {
      const crop = cropPixels(px, band);
      const png = await sharp(Buffer.from(rgba8(crop)), { raw: { width: crop.width, height: crop.height, channels: 4 } }).png().toBuffer();
      const rel = `pieces/${hit.role}-${normalizeWords(line).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || hit.ref.replace(/\W/g, "_")}.png`;
      put(rel, png, "image/png");
      pieces.push({
        role: hit.role as PieceRecord["role"],
        label: sharedWith.length ? `${line} (${[hit.role, ...sharedWith].join(" + ")} in one layer)` : line,
        artist: null,
        file: rel,
        width: crop.width,
        height: crop.height,
        cap_px: crop.height,
        source_ref: hit.ref,
        canvas: { left: (found!.layer.left ?? 0) + band.left, top: (found!.layer.top ?? 0) + band.top },
      });
    }
  }

  put("manifest.json", Buffer.from(JSON.stringify({ ...manifest, roles, preview: previewNote, layer_files: Object.fromEntries(layerFiles) }, null, 2)), "application/json");
  put("pieces.json", Buffer.from(JSON.stringify({ psd: file.name, width: psd.width, height: psd.height, facts, pieces, notes }, null, 2)), "application/json");

  // ─── Report ───────────────────────────────────────────────────────────────
  say(`## ${file.name} · ${manifest.width}×${manifest.height}${manifest.ppi ? ` @ ${manifest.ppi} ppi` : ""} · ${manifest.color_mode ?? "?"} ${manifest.bits_per_channel ?? "?"}-bit · read in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  say(`Preview: ${previewNote}`);
  say(`Fonts named: ${manifest.fonts.join(", ") || "none"}`);
  say("");
  say("| ref | layer | kind | shown | bounds | opacity · blend | effects | text / font / size / tracking |");
  say("|---|---|---|---|---|---|---|---|");
  for (const layer of allLayers(manifest.layers)) say(layerRow(layer));
  say("");
  say("Roles:");
  for (const role of ["headliner_names", "info", "title", "logo", "background", "panel"] as const) {
    const hits = roles.filter((r) => r.role === role);
    say(`- ${role}: ${hits.length ? hits.map((h: RoleHit) => `${h.ref} "${h.name}" (${h.why})`).join("; ") : "not found"}`);
  }
  say("");
  say("Pieces (from the PSD's own pixels):");
  for (const p of pieces) {
    const needCap = p.role === "name" ? 0.1146 * 1920 : p.role === "info" ? 0.031 * 1920 : null;
    // An info line in this face has no descenders, so its ink height is its cap.
    const at1080 = needCap ? ` · at 1080 the slot wants cap ${Math.round(needCap)} px → ${p.cap_px >= needCap ? `usable (scale ${(needCap / p.cap_px).toFixed(2)}, no enlargement)` : `SHORT: would need ${(needCap / p.cap_px).toFixed(2)}× enlargement`}` : "";
    say(`- ${p.role} "${p.label}"${p.artist ? ` (${p.artist})` : ""}: ${p.width}×${p.height} px ink, cap ≈ ${p.cap_px} px${at1080}`);
  }
  for (const n of notes) say(`- ! ${n}`);
  for (const h of headliners) if (!pieces.some((p) => p.artist === h)) say(`- ! no name piece for headliner ${h}`);
  say("");

  if (apply) {
    for (const w of written) {
      const saved = await uploadToStorageBucket(supabase, "campaign-assets", w.path, w.bytes, w.type);
      if (saved.error) fail(`Storage ${w.path}: ${saved.error.message}`);
    }
    say(`Stored ${written.length} files under campaign-assets ${kitPrefix(event.id, file.name)}`);
    const name = await freeDriveName(drive, openFiles, `${file.name.replace(/\.(psd|psb)$/i, "")} — preview.png`);
    const uploaded = await drive.uploadFile({
      parentId: openFiles,
      name,
      mimeType: "image/png",
      bytes: preview,
      appProperties: { [APP_TAG_KEY]: "psd_kit_preview", [APP_ID_KEY]: `${event.id}:${slug}` },
    });
    say(`Drive: 01 Open files / ${name} → https://drive.google.com/file/d/${uploaded.id}/view`);
    say("");
  }
}

writeFileSync(join(outRoot, "report.md"), report.join("\n") + "\n");
console.log(`Local kit: ${outRoot}`);

// ─── Helpers ────────────────────────────────────────────────────────────────

function layerRow(layer: KitLayer): string {
  const b = layer.bounds;
  const box = b ? `${b.left},${b.top} ${b.width}×${b.height}` : "—";
  const fx = layer.effects
    ? [
        ...layer.effects.shadows.map((s) => `${s.kind} ${s.enabled ? "" : "(off) "}${s.opacity ?? "?"}·${s.distance_px ?? "?"}px·${s.size_px ?? "?"}px·${s.angle ?? "?"}°`),
        ...layer.effects.stroke.map((s) => `stroke ${s.size_px ?? "?"}px ${s.color ?? ""}`),
        ...layer.effects.other,
      ].join("; ")
    : "";
  const t = layer.text
    ? `"${layer.text.content.replace(/\s+/g, " ").slice(0, 60)}" · ${layer.text.fonts.join("/")} · ${layer.text.size_pt ?? "?"} pt (${layer.text.size_px ?? "?"} px) · tracking ${layer.text.tracking ?? "?"}`
    : layer.smart_object
      ? `smart object ${layer.smart_object.linked_file_name ?? "?"} (${layer.smart_object.linked_file_type ?? "?"}, ${layer.smart_object.embedded ? "embedded" : "linked"}${layer.smart_object.read_error ? `, unreadable: ${layer.smart_object.read_error}` : layer.smart_object.layers.length ? `, ${layer.smart_object.layers.length} layers inside` : ""})`
      : "";
  const indent = "· ".repeat(layer.path.length + (layer.ref.split(">").length - 1));
  return `| ${layer.ref} | ${indent}${layer.name.replace(/\|/g, "/")} | ${layer.kind}${layer.has_pixels ? "" : " (no px)"} | ${layer.shown ? "yes" : layer.visible ? "parent hidden" : "hidden"} | ${box} | ${layer.opacity} · ${layer.blend_mode}${layer.clipping ? " · clip" : ""} | ${fx} | ${t.replace(/\|/g, "/")} |`;
}

/** Stream a Drive file to the cache (alt=media, supportsAllDrives) and read it back once. */
async function cachedDownload(fileId: string, name: string, size: number | null): Promise<Uint8Array> {
  mkdirSync(cacheDir, { recursive: true });
  const path = join(cacheDir, name);
  if (!(existsSync(path) && size != null && statSync(path).size === Number(size))) {
    const sa = loadExportServiceAccount(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON);
    const tokenRes = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signDriveJwt(sa) }).toString(),
    });
    const token = ((await tokenRes.json()) as { access_token?: string }).access_token;
    if (!tokenRes.ok || !token) fail(`Drive token request failed (HTTP ${tokenRes.status})`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok || !res.body) fail(`Drive download ${name}: HTTP ${res.status}`);
    const partial = `${path}.part`;
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(partial));
    renameSync(partial, path);
  }
  const buf = readFileSync(path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function freeDriveName(api: DriveApi, parentId: string, name: string): Promise<string> {
  const taken = new Set((await api.listChildren(parentId)).map((f) => f.name));
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  for (let v = 2; v < 100; v += 1) {
    const next = `${name.slice(0, dot)} _v${v}${name.slice(dot)}`;
    if (!taken.has(next)) return next;
  }
  throw new Error(`no free name for ${name}`);
}
