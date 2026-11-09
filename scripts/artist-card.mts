/**
 * Draft artist cards for an event's headliners, from the PSD kit's pieces
 * (scripts/psd-kit.mts) and the artists' imported press photos. A prototype
 * for design to judge: nothing is written to the Lab tables, no round, no Meta.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/artist-card.mts --event P26-BDAY \
 *     --kit outputs/P26-BDAY/kits/puzzle-birthday-1-static \
 *     --pick 'Luke Dean#1=<creative_assets id>' --pick 'Enzo Siragusa#2=<id>' … [--version 3] [--apply]
 *
 *   … --scan 'Enzo Siragusa' --scan Reeshy      judge every press photo, render nothing
 *
 * --pick ARTIST#N=ASSET: card N for that headliner from that photo (#N may be
 * left out: cards are then numbered in order). Each card is judged against the
 * photo rules in lib/creative-lab/artist-card.ts; a card that fails one is
 * skipped and reported, never covered with a scrim. A passing card is written
 * as 9:16, 4:5 and 1:1.
 *
 * Default: writes PNGs and report.md to --out (default outputs/{CODE}/cards).
 * --apply also copies them into the event's Drive tree, routed by
 * cardFolderKey (on sale → 03 Creatives / 3 On sale / w/c … / Content),
 * tagged so the pickup skips them. A photo that needs more room above or
 * at the sides is extended per O20 (lib/creative-lab/artist-card.ts) and the
 * card's line says "photo extended … by N px". Files are named with
 * _v{--version} (default 1: no suffix), and the next free _vN when that
 * name is taken. Nothing is
 * overwritten, trashed or deleted.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { cardFileName, cardFolderKey, INVENTED, renderCard, trimToInk, type CardFormat, type Piece, type RenderResult } from "../lib/creative-lab/artist-card.ts";
import { detectFaces, eyesMeasurable, faceGeometry, type FaceBox } from "../lib/creative-lab/face-detect.ts";
import { APP_ID_KEY, APP_TAG_KEY, driveFromEnv } from "../lib/drive/client.ts";
import type { DriveDb } from "../lib/drive/db.ts";
import { ensureEventKey } from "../lib/drive/folders.ts";
import { artistSlug, cycleKey, cycleMondayFor, londonToday, renderStage, showWeekMonday } from "../lib/drive/tree.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const many = (name: string) => argv.flatMap((arg, i) => (arg === name && argv[i + 1] ? [argv[i + 1]!] : []));
const apply = argv.includes("--apply");
const code = flag("--event")?.trim() ?? "";
const kitDir = flag("--kit") ?? "";
const outDir = flag("--out") ?? join("outputs", code, "cards");
const version = Number(flag("--version") ?? "1");
const scans = many("--scan");
const numbered = new Map<string, number>();
const picks = many("--pick").map((p) => {
  const at = p.lastIndexOf("=");
  const [artist, n] = p.slice(0, at).split("#");
  const name = artist!.trim();
  const card = n ? Number(n) : (numbered.get(name) ?? 0) + 1;
  numbered.set(name, card);
  return { artist: name, card, assetId: p.slice(at + 1).trim() };
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}
if (!code || !kitDir) fail("--event and --kit are required");
if (!picks.length && !scans.length) fail("--pick ARTIST#N=ASSET or --scan ARTIST is required");
if (!Number.isInteger(version) || version < 1) fail("--version takes a whole number from 1");

type PieceRecord = { role: string; label: string; artist: string | null; file: string; width: number; height: number; cap_px: number };
type PiecesFile = { psd: string; pieces: PieceRecord[]; notes: string[] };

const piecesPath = join(kitDir, "pieces.json");
if (!existsSync(piecesPath)) fail(`${piecesPath} not found — run scripts/psd-kit.mts first`);
const kit = JSON.parse(readFileSync(piecesPath, "utf8")) as PiecesFile;

async function piece(record: PieceRecord): Promise<Piece> {
  const trimmed = await trimToInk(readFileSync(join(kitDir, record.file)));
  return { png: trimmed.png, width: trimmed.width, height: trimmed.height, capPx: Math.min(record.cap_px, trimmed.height), label: record.label };
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const supabase = createClient(url, key, { auth: { persistSession: false } });

const eventRes = await supabase
  .from("events")
  .select("id, name, client_id, event_code, event_date, status, drive_folder_id, drive_folder_linked, drive_cancel_marked_at")
  .eq("event_code", code)
  .maybeSingle();
if (eventRes.error) fail(eventRes.error.message);
const event = eventRes.data;
if (!event) fail(`No event ${code}`);

const info = await Promise.all(kit.pieces.filter((p) => p.role === "info").map(piece));
const lockupRecord = kit.pieces.find((p) => p.role === "logo") ?? null;
const lockup = lockupRecord ? await piece(lockupRecord) : null;

const lines: string[] = [];
const say = (line = "") => {
  console.log(line);
  lines.push(line);
};

/** One subject: faces at 0.3 confidence at least 0.4× the main face's height. */
function countSubjects(faces: readonly FaceBox[]): number {
  const main = faces[0];
  return main ? faces.filter((f) => f.height >= 0.4 * main.height).length : 0;
}

async function download(storagePath: string): Promise<Buffer> {
  const file = await supabase.storage.from("campaign-assets").download(storagePath);
  if (file.error || !file.data) fail(`download ${storagePath}: ${file.error?.message}`);
  return Buffer.from(await file.data.arrayBuffer());
}

async function judge(photo: Buffer, artist: string): Promise<{ card: RenderResult; faces: FaceBox[] }> {
  const nameRecord = kit.pieces.find((p) => p.role === "name" && p.artist?.toLowerCase() === artist.toLowerCase());
  if (!nameRecord) fail(`${artist}: no name piece in ${kit.psd}`);
  const faces = await detectFaces(photo, { minConfidence: 0.3 });
  const geometry = faces.length ? ((await faceGeometry(photo, faces.slice(0, 1)))[0] ?? null) : null;
  const eyes = geometry ? eyesMeasurable(geometry) : undefined;
  const card = await renderCard({ photo, face: geometry, eyes, subjects: countSubjects(faces), name: await piece(nameRecord), info, lockup });
  return { card, faces };
}

function ruleLine(card: RenderResult): string {
  const p = card.plan;
  const fails = card.rules.filter((r) => !r.pass).map((r) => `${r.rule}: ${r.detail}`);
  const layout = card.layoutCheck.insideSafe && card.layoutCheck.insideTextBox ? "" : ` · LAYOUT: ${card.layoutCheck.outside.join(", ") || "text block outside 0.188–0.512 H"}`;
  const ext = card.extensionLabel ? ` · ${card.extensionLabel}` : " · no extension";
  const where = p ? `head ${p.headTop.toFixed(3)} (${card.headTopSource}) · eyes ${p.eyes.toFixed(3)} · chin ${p.chin.toFixed(3)} H · face box ${Math.round(p.faceWidthPx)} px · scale ${p.scale.toFixed(3)}${ext}` : "no face";
  return `${card.pass ? "PASS" : "FAIL"} · contrast ${(card.contrastShare * 100).toFixed(1)} % · ${where}${fails.length ? ` · fails ${fails.join("; ")}` : ""}${layout}`;
}

function mkdirOut(): string {
  mkdirSync(outDir, { recursive: true });
  return outDir;
}

say(`# Artist cards ${scans.length ? "SCAN" : apply ? "APPLY" : "LOCAL"} · ${code} · ${event.name} · ${londonToday(new Date())}`);
say(`Pieces from ${kit.psd} (${kitDir}): info ${info.map((d) => `"${d.label}"`).join(", ") || "MISSING"} · lockup ${lockup ? `"${lockup.label}"` : "MISSING"}`);
say("");

// ─── Scan ───────────────────────────────────────────────────────────────────

if (scans.length) {
  for (const artist of scans) {
    const lab = await supabase.from("creative_lab_artists").select("id, name").eq("client_id", String(event.client_id)).ilike("name", artist).maybeSingle();
    if (lab.error || !lab.data) fail(`${artist}: no Lab artist on this client`);
    const assets = await supabase
      .from("creative_assets")
      .select("id, storage_path, filename")
      .like("storage_path", `images/creative-lab/${lab.data.id}/%`)
      .order("filename")
      .range(0, 999);
    if (assets.error) fail(assets.error.message);
    say(`## ${artist} · ${assets.data.length} images`);
    for (const asset of assets.data) {
      if (/\.png$/i.test(String(asset.storage_path))) {
        say(`- ${asset.filename} (${asset.id}): logo, skipped`);
        continue;
      }
      const { card, faces } = await judge(await download(String(asset.storage_path)), artist);
      say(`- ${asset.filename} (${asset.id}): ${faces.length} face(s) · ${ruleLine(card)}`);
    }
    say("");
  }
  writeFileSync(join(mkdirOut(), "scan.md"), lines.join("\n") + "\n");
  process.exit(0);
}

// ─── Cards ──────────────────────────────────────────────────────────────────

const today = londonToday(new Date());
const stage = renderStage(event.status) === "on-sale" ? "on-sale" : "presale";
const folderKey = cardFolderKey({ stage, today, eventDate: event.event_date, cycleKeyFor: (day) => cycleKey(cycleMondayFor(day)), showWeekMonday });
say(`Drive folder key: ${folderKey} (stage ${stage}) · version _v${version}`);
say("");

const { drive, reason } = driveFromEnv();
if (apply && !drive) fail(`--apply needs the export drive: ${reason}`);
let driveFolder: string | null = null;
let taken = new Set<string>();
if (apply && drive) {
  const clientRes = await supabase.from("clients").select("id, name, status, drive_folder_id").eq("id", String(event.client_id)).maybeSingle();
  if (clientRes.error || !clientRes.data) fail(clientRes.error?.message ?? "no client");
  driveFolder = await ensureEventKey(supabase as unknown as DriveDb, drive, event as never, clientRes.data as never, folderKey);
  taken = new Set((await drive.listChildren(driveFolder)).map((f) => f.name));
}

mkdirOut();
for (const pick of picks) {
  const assetRes = await supabase.from("creative_assets").select("id, storage_path, filename").eq("id", pick.assetId).maybeSingle();
  if (assetRes.error || !assetRes.data) fail(`asset ${pick.assetId}: ${assetRes.error?.message ?? "not found"}`);
  const { card, faces } = await judge(await download(String(assetRes.data.storage_path)), pick.artist);
  say(`## ${pick.artist} · card ${pick.card} · ${assetRes.data.filename} (${pick.assetId})`);
  say(`${faces.length} face(s) · ${ruleLine(card)}`);
  for (const p of card.layout.all) {
    say(`- ${p.label}: ${p.width}×${p.height} at ${p.left},${p.top} · scale ${p.scale.toFixed(3)}${p.stepped ? " · stepped to width" : ""}${p.belowFloor ? " · BELOW FLOOR" : ""}${p.short ? " · SHORT" : ""}`);
  }
  for (const [edge, st] of Object.entries(card.strips)) {
    say(`- O20 ${edge} strip: detail stdev ${st.detailStdev.toFixed(2)} (max 4) · Sobel > 20 on ${(st.sobelShare * 100).toFixed(2)} % (max 2 %) · grain added at ${st.detailStdev.toFixed(2)}`);
  }
  if (card.squarePhotoScale > 0.8001) say(`- 1:1: the photo is too narrow to extend at the sides; drawn at ${card.squarePhotoScale.toFixed(3)}× the master's scale (not 0.8×), anchored on the eyes`);
  if (card.squareShift) say(`- 1:1: the photo ran out; its window shifted ${card.squareShift} px (the text stays centred)`);
  if (!card.pass) {
    say("Skipped: fails a rule. Nothing written.");
    say("");
    continue;
  }
  const slug = artistSlug(pick.artist);
  const outputs: { format: CardFormat; bytes: Buffer }[] = [
    { format: "9x16", bytes: card.master },
    { format: "4x5", bytes: card.crop45 },
    { format: "1x1", bytes: card.square },
  ];
  for (const o of outputs) {
    const name = cardFileName({ eventCode: code, artistSlug: slug, pick: pick.card, stage, format: o.format, version });
    writeFileSync(join(outDir, name), o.bytes);
    let link = "";
    if (apply && drive && driveFolder) {
      let free = name;
      for (let v = version + 1; taken.has(free); v += 1) free = cardFileName({ eventCode: code, artistSlug: slug, pick: pick.card, stage, format: o.format, version: v });
      const up = await drive.uploadFile({
        parentId: driveFolder,
        name: free,
        mimeType: "image/png",
        bytes: o.bytes,
        appProperties: { [APP_TAG_KEY]: "artist_card_draft", [APP_ID_KEY]: `${event.id}:${slug}:${pick.card}:${o.format}` },
      });
      taken.add(free);
      link = ` → Drive ${free}: https://drive.google.com/file/d/${up.id}/view`;
    }
    say(`- ${join(outDir, name)}${link}`);
  }
  say("");
}

say("Invented on these cards (no asset, PSD, record or ruling value):");
for (const line of INVENTED) say(`- ${line}`);
writeFileSync(join(outDir, "report.md"), lines.join("\n") + "\n");
