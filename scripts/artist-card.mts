/**
 * Draft artist cards for an event's headliners, from the PSD kit's pieces
 * (scripts/psd-kit.mts) and the artists' imported press photos. A prototype
 * for design to judge: nothing is written to the Lab tables, no round, no Meta.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/artist-card.mts --event P26-BDAY \
 *     --kit outputs/P26-BDAY/kits/puzzle-birthday-1-story \
 *     --pick 'Enzo Siragusa=<creative_assets id>' --pick 'Enzo Siragusa=<id>' … [--apply]
 *
 * --pick ARTIST=ASSET (repeatable, in order): the photos for that headliner,
 * card 1, card 2, … Each card is a 1080×1920 master and its 1080×1350 centre
 * crop. --logo-width F sizes the logo piece to F × W (default 0.15). --info-from KIT takes the info / logo pieces from another kit directory
 * when the name kit lacks them.
 *
 * Default: writes PNGs and report.md to --out (default outputs/{CODE}/cards).
 * --apply also copies the PNGs into the event's Drive tree, routed by
 * cardFolderKey (on sale → 03 Creatives / 3 On sale / w/c … / Content;
 * otherwise 2 Presale / Presale live), tagged so the pickup skips them, with
 * _v2, _v3 on a name already there. Nothing is overwritten or deleted.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { cardFileName, cardFolderKey, INVENTED, renderCard, trimToInk, type Piece } from "../lib/creative-lab/artist-card.ts";
import { detectFaces, type FaceBox } from "../lib/creative-lab/face-detect.ts";
import { APP_ID_KEY, APP_TAG_KEY, driveFromEnv } from "../lib/drive/client.ts";
import type { DriveDb } from "../lib/drive/db.ts";
import { ensureEventKey } from "../lib/drive/folders.ts";
import { artistSlug, cycleKey, cycleMondayFor, londonToday, renderStage, showWeekMonday } from "../lib/drive/tree.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const apply = argv.includes("--apply");
const code = flag("--event")?.trim() ?? "";
const kitDir = flag("--kit") ?? "";
const infoDir = flag("--info-from") ?? kitDir;
const logoWidth = flag("--logo-width") ? Number(flag("--logo-width")) : undefined;
const outDir = flag("--out") ?? join("outputs", code, "cards");
const picks = argv.flatMap((arg, i) => (arg === "--pick" && argv[i + 1] ? [argv[i + 1]!] : [])).map((p) => {
  const at = p.lastIndexOf("=");
  return { artist: p.slice(0, at).trim(), assetId: p.slice(at + 1).trim() };
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}
if (!code || !kitDir) fail("--event and --kit are required");
if (!picks.length) fail("--pick ARTIST=ASSET is required at least once");

type PieceRecord = { role: string; label: string; artist: string | null; file: string; width: number; height: number; cap_px: number };
type PiecesFile = { psd: string; pieces: PieceRecord[]; notes: string[] };

function loadPieces(dir: string): PiecesFile {
  const path = join(dir, "pieces.json");
  if (!existsSync(path)) fail(`${path} not found — run scripts/psd-kit.mts first`);
  return JSON.parse(readFileSync(path, "utf8")) as PiecesFile;
}

async function piece(dir: string, record: PieceRecord): Promise<Piece> {
  const trimmed = await trimToInk(readFileSync(join(dir, record.file)));
  return { png: trimmed.png, width: trimmed.width, height: trimmed.height, capPx: Math.min(record.cap_px, trimmed.height), label: record.label };
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const supabase = createClient(url, key, { auth: { persistSession: false } });

const eventRes = await supabase.from("events").select("id, name, client_id, event_code, event_date, status, drive_folder_id, drive_folder_linked, drive_cancel_marked_at").eq("event_code", code).maybeSingle();
if (eventRes.error) fail(eventRes.error.message);
const event = eventRes.data;
if (!event) fail(`No event ${code}`);

const nameKit = loadPieces(kitDir);
const infoKit = infoDir === kitDir ? nameKit : loadPieces(infoDir);
const infoRecords = infoKit.pieces.filter((p) => p.role === "info");
const logoRecord = infoKit.pieces.find((p) => p.role === "logo") ?? null;
const details = await Promise.all(infoRecords.map((r) => piece(infoDir, r)));
const logo = logoRecord ? await piece(infoDir, logoRecord) : null;

const today = londonToday(new Date());
const stage = renderStage(event.status) === "on-sale" ? "on-sale" : "presale";
const folderKey = cardFolderKey({
  stage,
  today,
  eventDate: event.event_date,
  cycleKeyFor: (day) => cycleKey(cycleMondayFor(day)),
  showWeekMonday,
});

mkdirSync(outDir, { recursive: true });
const lines: string[] = [];
const say = (line = "") => {
  console.log(line);
  lines.push(line);
};
say(`# Artist cards ${apply ? "APPLY" : "LOCAL"} · ${code} · ${event.name} · ${today}`);
say(`Names from ${nameKit.psd} (${kitDir}); info and logo from ${infoKit.psd} (${infoDir})`);
say(`Details pieces: ${details.map((d) => `"${d.label}"`).join(", ") || "MISSING"} · logo: ${logo ? `"${logo.label}"` : "MISSING"}`);
say(`Drive folder key: ${folderKey} (stage ${stage})`);
say("");

const { drive, reason } = driveFromEnv();
if (apply && !drive) fail(`--apply needs the export drive: ${reason}`);
let driveFolder: string | null = null;
let taken = new Set<string>();
if (apply && drive) {
  const clientRes = await supabase.from("clients").select("id, name, status, drive_folder_id").eq("id", event.client_id!).maybeSingle();
  if (clientRes.error || !clientRes.data) fail(clientRes.error?.message ?? "no client");
  driveFolder = await ensureEventKey(supabase as unknown as DriveDb, drive, event as never, clientRes.data as never, folderKey);
  taken = new Set((await drive.listChildren(driveFolder)).map((f) => f.name));
}

const count = new Map<string, number>();
for (const pick of picks) {
  const nameRecord = nameKit.pieces.find((p) => p.role === "name" && p.artist?.toLowerCase() === pick.artist.toLowerCase());
  if (!nameRecord) {
    say(`! ${pick.artist}: no name piece in ${nameKit.psd} — card skipped`);
    continue;
  }
  const n = (count.get(pick.artist) ?? 0) + 1;
  count.set(pick.artist, n);
  const assetRes = await supabase.from("creative_assets").select("id, storage_path, filename").eq("id", pick.assetId).maybeSingle();
  if (assetRes.error || !assetRes.data) fail(`asset ${pick.assetId}: ${assetRes.error?.message ?? "not found"}`);
  const file = await supabase.storage.from("campaign-assets").download(String(assetRes.data.storage_path));
  if (file.error || !file.data) fail(`download ${assetRes.data.storage_path}: ${file.error?.message}`);
  const photo = Buffer.from(await file.data.arrayBuffer());
  const faces: FaceBox[] = await detectFaces(photo);
  const face = faces[0] ?? null;
  const card = await renderCard({ photo, face, name: await piece(kitDir, nameRecord), details, logo, logoWidth });
  const slug = artistSlug(pick.artist);
  const outputs = [
    { format: "9x16" as const, bytes: card.master },
    { format: "4x5" as const, bytes: card.crop45 },
  ];
  say(`## ${pick.artist} · card ${n} · ${assetRes.data.filename} (${pick.assetId})`);
  say(`Face: ${face ? `${Math.round(face.width)}×${Math.round(face.height)} at ${Math.round(face.x)},${Math.round(face.y)} (score ${face.score.toFixed(2)}, ${faces.length} found)` : "none found — centred cover crop"}`);
  say(`Crop: scale ${card.plan.scale.toFixed(3)}${card.plan.upscaled ? " (ENLARGED)" : ""}; face lands ${Math.round(card.plan.face.top)}–${Math.round(card.plan.face.top + card.plan.face.height)} px of 1920${card.plan.clamped.y || card.plan.clamped.x ? ` (clamped ${card.plan.clamped.x ? "x" : ""}${card.plan.clamped.y ? "y" : ""}: the photo ran out)` : ""}`);
  for (const p of card.placements) {
    say(`- ${p.label}: ${p.width}×${p.height} at ${p.left},${p.top} · scale ${p.scale.toFixed(3)}${p.stepped ? " · stepped to width" : ""}${p.belowFloor ? " · BELOW FLOOR" : ""}${p.short ? " · SHORT (would need enlarging)" : ""}`);
  }
  const c = card.check;
  say(`Check: face between details and claim boxes (0.4391–0.7536 H) ${c.faceInFaceBand ? "yes" : "NO"} · inside 4:5 ${c.faceInside45 ? "yes" : "NO"} · covered by ${c.faceCovered.join(", ") || "nothing"} · outside 4:5 ${c.outside45.join(", ") || "none"} · within 7 % W of an edge ${c.tooCloseToEdge.join(", ") || "none"}`);
  say(`Backdrop luminance under the name ${card.backdrop.name}/255, under the details ${card.backdrop.details}/255`);
  for (const o of outputs) {
    const name = cardFileName({ eventCode: code, artistSlug: slug, pick: n, stage, format: o.format });
    writeFileSync(join(outDir, name), o.bytes);
    let link = "";
    if (apply && drive && driveFolder) {
      let free = name;
      for (let v = 2; taken.has(free); v += 1) free = name.replace(/\.png$/, `_v${v}.png`);
      const up = await drive.uploadFile({
        parentId: driveFolder,
        name: free,
        mimeType: "image/png",
        bytes: o.bytes,
        appProperties: { [APP_TAG_KEY]: "artist_card_draft", [APP_ID_KEY]: `${event.id}:${slug}:${n}:${o.format}` },
      });
      taken.add(free);
      link = ` → Drive ${free}: https://drive.google.com/file/d/${up.id}/view`;
    }
    say(`- ${join(outDir, name)}${link}`);
  }
  say("");
}

say("Invented on these cards (no asset, PSD or record value):");
for (const line of INVENTED) say(`- ${line}`);
writeFileSync(join(outDir, "report.md"), lines.join("\n") + "\n");
