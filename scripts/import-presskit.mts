/**
 * Import an artist's press pack (a shared Dropbox folder) into the Creative Lab.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/import-presskit.mts \
 *     --artist <lab artist id> --folder '<dropbox folder url>' [--event <event id>] \
 *     [--exclude '/b2b/i'] [--videos-only | --images-only] [--max N] [--apply]
 *
 * Dry run by default: lists Videos/, Press Pictures/ and Logo/ (metadata only)
 * and SELECTs from Supabase. Nothing is downloaded or written. It prints what
 * --apply would do: each file kept or skipped, with the reason and the size.
 *
 * --apply:
 *   Videos   each kept file in Videos/ goes through importArtistClips as source
 *            'presskit' (dedupe by file id and sha256, 30 s trim, rights_ref from
 *            the artist), then the burned-in text check (one Lambda still + one
 *            claude-sonnet-4-6 call), stored on creative_lab_clips.overlay_check.
 *            The artist's own clip_folder_url and its synced/error state are left as they are.
 *   Images   Press Pictures/ and Logo/ → campaign-assets
 *            images/creative-lab/{artistId}/{sha256}.{ext} + a creative_assets row.
 *
 * --exclude takes /pattern/flags or a bare word (case-insensitive). Default /b2b/i.
 * --max N caps new files per kind (videos, images).
 * --event checks the artist's clips show on that event's Lab (same client). The
 * clips' own event_id stays null: a press-kit clip was not filmed at the show.
 *
 * --apply with videos needs REMOTION_LAMBDA_SERVE_URL, REMOTION_AWS_* and
 * ANTHROPIC_API_KEY for the text check.
 */

import { createClient } from "@supabase/supabase-js";

import { fetchDropboxFileContent, isDropboxFolderUrl, listDropboxFolderFiles } from "../lib/clients/asset-queue/dropbox.ts";
import { uploadToStorageBucket } from "../lib/clients/asset-queue/storage-upload.ts";
import type { ServiceRoleDb } from "../lib/creative-lab/load.ts";
import {
  importPresskitImages,
  importPresskitVideos,
  parseExclude,
  planPresskit,
  type PlanRow,
  type PresskitMode,
  type PresskitSource,
} from "../lib/creative-lab/presskit.ts";

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const apply = argv.includes("--apply");
const artistId = flag("--artist")?.trim() ?? "";
const folderUrl = flag("--folder")?.trim() ?? "";
const eventId = flag("--event")?.trim() || null;
const exclude = parseExclude(flag("--exclude"));
const maxArg = flag("--max");
const max = maxArg ? Number(maxArg) : undefined;
const videosOnly = argv.includes("--videos-only");
const imagesOnly = argv.includes("--images-only");
const mode: PresskitMode = videosOnly ? "videos" : imagesOnly ? "images" : "all";

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

if (!artistId || !folderUrl) fail("--artist and --folder are required");
if (!isDropboxFolderUrl(folderUrl)) fail("--folder must be a Dropbox shared folder link (/scl/fo/)");
if (videosOnly && imagesOnly) fail("--videos-only and --images-only cannot both be set");
if (max != null && !(Number.isInteger(max) && max > 0)) fail("--max takes a whole number above 0");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (apply && mode !== "images") {
  const missing = ["REMOTION_LAMBDA_SERVE_URL", "REMOTION_AWS_ACCESS_KEY_ID", "REMOTION_AWS_SECRET_ACCESS_KEY", "ANTHROPIC_API_KEY"].filter((name) => !process.env[name]?.trim());
  if (missing.length) fail(`--apply with videos needs ${missing.join(", ")} for the burned-in text check. Add them to .env.local, or run --images-only.`);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const db = supabase as unknown as ServiceRoleDb;

const source: PresskitSource = {
  async list(subfolder) {
    const entries = await listDropboxFolderFiles(folderUrl, { path: subfolder });
    return entries.map((entry) => ({ sourceFileId: entry.path_lower, name: entry.name, size: entry.size }));
  },
  async download(file) {
    return (await fetchDropboxFileContent(folderUrl, { name: file.name, path_lower: file.sourceFileId })).buffer;
  },
};

// Dropbox's own progress lines stay out of the report.
const log = console.log;
console.log = (...items: unknown[]) => {
  if (typeof items[0] === "string" && /^\[dropbox(-auth)?\]/.test(items[0])) return;
  log(...items);
};

function mb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const artistRes = await supabase.from("creative_lab_artists").select("*").eq("id", artistId).maybeSingle();
if (artistRes.error) fail(artistRes.error.message);
const artist = artistRes.data as Record<string, unknown> | null;
if (!artist) fail("No Lab artist with that id.");
const folderBefore = {
  clip_folder_url: artist.clip_folder_url ?? null,
  clip_folder_synced_at: artist.clip_folder_synced_at ?? null,
  clip_folder_last_error: artist.clip_folder_last_error ?? null,
  clip_source: artist.clip_source ?? null,
};

console.log(`# Press kit import ${apply ? "APPLY" : "DRY RUN — nothing downloaded or written"}`);
console.log(`Artist: ${String(artist.name)} (${artistId}) · cleared ${artist.approved_at ? String(artist.approved_at).slice(0, 10) : "no"} · rights_ref "${String(artist.rights_doc_ref ?? "").trim() || "Promoter page"}"`);
if (eventId) {
  const event = await supabase.from("events").select("id, name, client_id").eq("id", eventId).maybeSingle();
  if (event.error) fail(event.error.message);
  if (!event.data) fail("No event with that id.");
  const same = String(event.data.client_id ?? "") === String(artist.client_id ?? "");
  console.log(`Event: ${String(event.data.name)} (${eventId}) · ${same ? "same client, so the clips show on its Lab" : "DIFFERENT client — the clips will not show on its Lab"}`);
  if (!same && apply) fail("The artist is not on this event's client. Nothing written.");
}
console.log(`Exclude: ${exclude} · mode: ${mode}${max ? ` · max ${max} per kind` : ""}\n`);

function table(rows: { name: string; size: number; action: string; reason: string | null; extra?: string }[]): void {
  for (const row of rows) {
    console.log(`| ${row.action} | ${row.name} | ${mb(row.size)} | ${row.reason ?? ""}${row.extra ? ` | ${row.extra}` : ""} |`);
  }
}

function summary(rows: PlanRow[], label: string): void {
  const kept = rows.filter((row) => row.action === "import");
  const skipped = rows.filter((row) => row.action === "skip");
  console.log(`${label}: ${kept.length} kept (${mb(kept.reduce((sum, row) => sum + row.size, 0))}), ${skipped.length} skipped`);
}

if (!apply) {
  const plan = await planPresskit(db, { artistId, source, exclude, mode, max });
  const videos = plan.filter((row) => row.kind === "video");
  const press = plan.filter((row) => row.group === "press");
  const logo = plan.filter((row) => row.group === "logo");
  if (mode !== "images") {
    console.log("## Videos/ (clips, source presskit)\n\n| would | file | size | reason |\n|---|---|---|---|");
    table(videos.map((row) => ({ ...row, action: row.action === "import" ? "import" : "skip" })));
    console.log("");
    summary(videos, "Videos");
    console.log("A kept file whose bytes match a clip already imported is skipped at --apply (that needs the download).\n");
  }
  if (mode !== "videos") {
    for (const [title, rows] of [["Press Pictures/", press], ["Logo/", logo]] as const) {
      console.log(`## ${title} (creative_assets, media_kind image)\n\n| would | file | size | reason |\n|---|---|---|---|`);
      table(rows.map((row) => ({ ...row, action: row.action === "import" ? "import" : "skip" })));
      console.log("");
      summary(rows, title);
      console.log("");
    }
    console.log("Aspect and pixel size are read at --apply (they need the file).");
  }
  process.exit(0);
}

async function upload(storagePath: string, bytes: Buffer, contentType: string): Promise<void> {
  const saved = await uploadToStorageBucket(supabase, "campaign-assets", storagePath, bytes, contentType);
  if (saved.error) throw new Error(saved.error.message ?? "Could not store the file.");
}

if (mode !== "images") {
  const { judgeOverlay } = await import("../lib/creative-lab/overlay-run.ts");
  let lambdaUsd = 0;
  const result = await importPresskitVideos(db, {
    artistId,
    folderUrl,
    source,
    exclude,
    max,
    upload,
    sign: async (storagePath) => (await supabase.storage.from("campaign-assets").createSignedUrl(storagePath, 60 * 30)).data?.signedUrl ?? null,
    judge: async (input) => {
      const judged = await judgeOverlay(input);
      lambdaUsd += judged.lambdaCostUsd ?? 0;
      return judged;
    },
  });
  if (result.folderError) fail(`Videos/: ${result.folderError}`);
  console.log("## Videos/\n\n| outcome | file | size | note | burned-in text |\n|---|---|---|---|---|");
  table(result.files.map((file) => ({
    name: file.name,
    size: file.size ?? 0,
    action: file.outcome,
    reason: file.reason,
    extra: file.overlay ? `${file.overlay.verdict} — ${file.overlay.reason}` : "",
  })));
  for (const row of result.rechecked) console.log(`Rechecked clip ${row.clipId}: ${row.check.verdict} — ${row.check.reason}`);
  console.log(`\nLambda frame sheets: ~$${lambdaUsd.toFixed(4)}`);
}

if (mode !== "videos") {
  const rows = await importPresskitImages(db, { artistId, source, exclude, max, upload });
  for (const group of ["press", "logo"] as const) {
    console.log(`\n## ${group === "press" ? "Press Pictures/" : "Logo/"} manifest\n\n| outcome | file | aspect | px | storage path | note |\n|---|---|---|---|---|---|`);
    for (const row of rows.filter((item) => item.group === group)) {
      const px = row.width && row.height ? `${row.width}×${row.height}` : "";
      console.log(`| ${row.outcome} | ${row.name} | ${row.aspect ?? ""} | ${px} | ${row.storagePath ?? ""} | ${row.reason ?? ""} |`);
    }
  }
}

const after = await supabase.from("creative_lab_artists").select("clip_folder_url, clip_folder_synced_at, clip_folder_last_error, clip_source").eq("id", artistId).maybeSingle();
const unchanged = JSON.stringify(after.data) === JSON.stringify(folderBefore);
console.log(`\nArtist's own folder state ${unchanged ? "unchanged" : "CHANGED"}: ${JSON.stringify(after.data)}`);
