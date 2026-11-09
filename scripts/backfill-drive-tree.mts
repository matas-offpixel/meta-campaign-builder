/**
 * Drive tree backfill: create the S18 tree for every active event (client
 * not archived, event not cancelled, date not past), this cycle's w/c folder
 * when on sale, and copy the event's finished round renders into it.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-drive-tree.mts
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-drive-tree.mts --event P26-BDAY
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-drive-tree.mts --apply
 *
 * Dry run by default: SELECTs only against Supabase, and read-only lookups
 * on the Shared Drive (find-before-create) when the export account is
 * configured. Prints the folders it would create and the files it would
 * copy. Nothing is written to Supabase, Storage or Drive. --apply writes and
 * needs migration 218. --event CODE (repeatable) scopes it.
 */

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../lib/db/database.types.ts";

import { fakeDb } from "../lib/creative-lab/__tests__/fake-db.ts";
import { isArchivedClientStatus } from "../lib/db/client-status.ts";
import { FOLDER_MIME, driveFromEnv, type DriveApi, type DriveFile } from "../lib/drive/client.ts";
import { fileRender, loadFilingContext, planFiling, wantsFiling } from "../lib/drive/filing.ts";
import { allRows, type DriveDb, type RowOf, type TableName } from "../lib/drive/db.ts";
import { emptyLog, ensureCycleFolder, ensureEventTree } from "../lib/drive/folders.ts";
import { isPast, onSaleFrom } from "../lib/drive/tick.ts";
import { cycleDue, isCancelled, londonToday } from "../lib/drive/tree.ts";

/** The dry run's in-memory tables (fakeDb). */
type Memory = { [K in TableName]?: RowOf<K>[] };

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const codes = argv.flatMap((arg, i) => (arg === "--event" && argv[i + 1] ? [argv[i + 1]!] : []));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const prod: DriveDb & ReturnType<typeof createClient<Database>> = createClient<Database>(url, key, { auth: { persistSession: false } });
const { drive: realDrive, reason } = driveFromEnv();
if (apply && !realDrive) {
  console.error(`--apply needs the export drive: ${reason}`);
  process.exit(2);
}

const now = new Date();
const today = londonToday(now);
console.log(`# Drive tree backfill ${apply ? "APPLY" : "DRY RUN — nothing written"} · ${today}`);
console.log(`Drive: ${realDrive ? `${realDrive.driveId} (find-before-create ${apply ? "and writes" : "read-only"})` : `not configured (${reason}) — every folder counts as new`}\n`);

const clients = await allRows(prod, "clients");
const events = await allRows(prod, "events");
const clientById = new Map(clients.map((c) => [String(c.id), c]));
const scoped = events.filter((event) => {
  const client = clientById.get(String(event.client_id));
  if (!client || isArchivedClientStatus(client.status)) return false;
  if (isCancelled(event.status) || isPast(event, today)) return false;
  return codes.length ? codes.includes(String(event.event_code ?? "")) : true;
});
if (codes.length) {
  for (const code of codes) if (!scoped.some((e) => e.event_code === code)) console.log(`! ${code}: no active event with that code (archived client, cancelled, past, or unknown)\n`);
}

/** The dry run's database: the prod rows in memory; writes stay in memory. */
async function dryDb(): Promise<{ db: DriveDb; tables: Memory }> {
  const eventIds = new Set(scoped.map((e) => String(e.id)));
  const captions = (await allRows(prod, "creative_lab_captions")).filter((c) => eventIds.has(String(c.event_id)));
  const captionIds = new Set(captions.map((c) => String(c.id)));
  const renders = (await allRows(prod, "creative_lab_renders")).filter((r) => captionIds.has(String(r.caption_id)));
  let folders: RowOf<"drive_folders">[] = [];
  const probe = await prod.from("drive_folders").select("*").range(0, 999);
  if (!probe.error) folders = (await allRows(prod, "drive_folders")).filter((f) => !f.event_id || eventIds.has(String(f.event_id)));
  else console.log(`(drive_folders not readable — migration 218 not applied: ${probe.error.message.slice(0, 80)})\n`);
  const fake = fakeDb({
    clients,
    events: scoped,
    drive_folders: folders,
    creative_lab_captions: captions,
    creative_lab_renders: renders,
    creative_lab_round_ads: await allRows(prod, "creative_lab_round_ads"),
    creative_lab_rounds: await allRows(prod, "creative_lab_rounds"),
    creative_lab_clips: await allRows(prod, "creative_lab_clips"),
    creative_lab_artists: await allRows(prod, "creative_lab_artists"),
    creative_assets: (await allRows(prod, "creative_assets")).filter((a) => renders.some((r) => r.creative_asset_id === a.id)),
  });
  return { db: fake as unknown as DriveDb, tables: fake.tables as unknown as Memory };
}

/** Real reads (when configured), simulated writes; remembers names for the printout. */
function dryDrive(real: DriveApi | null, driveId: string): DriveApi & { pathOf(id: string): string } {
  const made = new Map<string, DriveFile>();
  let next = 1;
  const names = new Map<string, { name: string; parent: string | null }>([[driveId, { name: "Off / Pixel", parent: null }]]);
  const remember = (file: DriveFile) => {
    names.set(file.id, { name: file.name, parent: file.parents?.[0] ?? null });
    return file;
  };
  return {
    driveId,
    async listChildren(parentId, opts) {
      const local = [...made.values()].filter((f) => f.parents?.includes(parentId) && (opts?.name == null || f.name === opts.name));
      if (!real || parentId.startsWith("new:")) return local;
      return [...(await real.listChildren(parentId, opts)).map(remember), ...local];
    },
    async createFolder(parentId, name) {
      const file = remember({ id: `new:${next++}`, name, mimeType: FOLDER_MIME, parents: [parentId] });
      made.set(file.id, file);
      return file;
    },
    async uploadFile(args) {
      const file = remember({ id: `new:${next++}`, name: args.name, mimeType: args.mimeType, parents: [args.parentId] });
      made.set(file.id, file);
      return file;
    },
    async createShortcut(args) {
      return remember({ id: `new:${next++}`, name: args.name, mimeType: "shortcut", parents: [args.parentId] });
    },
    async update(fileId, patch) {
      const known = names.get(fileId);
      if (known && patch.name) known.name = patch.name;
      return { id: fileId, name: patch.name ?? known?.name ?? "", mimeType: "" };
    },
    async getFile(fileId) {
      if (made.has(fileId)) return made.get(fileId)!;
      return real && !fileId.startsWith("new:") ? real.getFile(fileId) : null;
    },
    async download() {
      return new Uint8Array();
    },
    // The backfill never reads the changes feed or shares; the dry run refuses rather than guess.
    async startPageToken(): Promise<string> {
      throw new Error("the backfill does not read the changes feed");
    },
    async listChanges(): Promise<never> {
      throw new Error("the backfill does not read the changes feed");
    },
    async shareReader(): Promise<string> {
      throw new Error("the backfill never shares");
    },
    async removePermission() {
      throw new Error("the backfill never shares");
    },
    pathOf(id) {
      const parts: string[] = [];
      for (let cursor: string | null = id; cursor && names.has(cursor); cursor = names.get(cursor)!.parent) parts.unshift(names.get(cursor)!.name);
      return parts.join(" / ");
    },
  };
}

const driveId = realDrive?.driveId ?? process.env.GOOGLE_DRIVE_EXPORT_DRIVE_ID ?? "OFF_PIXEL";
const dry = apply ? null : await dryDb();
const db: DriveDb = dry ? dry.db : prod;
const drive = apply ? realDrive! : dryDrive(realDrive, driveId);

const dbEvents = dry ? (dry.tables.events ?? []) : scoped;
const dbClients = new Map((dry ? (dry.tables.clients ?? []) : clients).map((c) => [c.id, c]));

let folderTotal = 0;
let fileTotal = 0;
for (const event of dbEvents) {
  const client = dbClients.get(String(event.client_id))!;
  const log = emptyLog();
  console.log(`## ${event.event_code ?? "—"} · ${event.name} · ${event.event_date ?? "no date"} · ${event.status} · client ${client.name}`);
  try {
    const tree = await ensureEventTree(db, drive, event, client, log);
    if (!tree.folderId) {
      console.log(`  skipped: ${tree.skipped}\n`);
      continue;
    }
    const monday = cycleDue({ today, onSale: event.status === "on_sale", onSaleFrom: onSaleFrom(event), eventDate: event.event_date ?? null });
    if (monday) await ensureCycleFolder(db, drive, event, client, monday, log);
    console.log(`  folders to create: ${log.created.length}${log.found.length ? ` · already there: ${log.found.length}` : ""}`);
    for (const label of log.created) console.log(`    + Off / Pixel / ${label}`);
    for (const label of log.found) console.log(`    = Off / Pixel / ${label}`);
    for (const label of log.renamed) console.log(`    ~ ${label}`);
    folderTotal += log.created.length;

    const captionIds = new Set(
      (dry ? (dry.tables.creative_lab_captions ?? []) : await allRows(prod, "creative_lab_captions"))
        .filter((c) => c.event_id === event.id)
        .map((c) => String(c.id)),
    );
    const renders = (dry ? (dry.tables.creative_lab_renders ?? []) : await allRows(prod, "creative_lab_renders")).filter(
      (r) => captionIds.has(String(r.caption_id)) && wantsFiling(r, now),
    );
    const doneTotal = renders.length;
    let copied = 0;
    const skips: string[] = [];
    for (const render of renders) {
      const ctx = await loadFilingContext(db, render);
      if ("skip" in ctx) {
        skips.push(`${render.id}: ${ctx.skip}`);
        continue;
      }
      const plan = planFiling(ctx, today);
      const out = await fileRender(db, drive, render, {
        download: apply
          ? async (bucket, path) => {
              const { data, error } = await prod.storage.from(bucket).download(path);
              if (error || !data) throw new Error(`storage download: ${error?.message ?? "no file"}`);
              return new Uint8Array(await data.arrayBuffer());
            }
          : async () => new Uint8Array(),
        now,
        today,
      });
      if (out.ok) {
        copied += 1;
        const where = "pathOf" in drive ? (drive as ReturnType<typeof dryDrive>).pathOf(out.fileId) : `${plan.key}/${out.fileName}`;
        console.log(`    → ${where}  (from ${plan.bucket}/${plan.path})`);
      } else if ("error" in out) {
        console.log(`    ✗ ${render.id}: ${out.error}`);
      }
    }
    console.log(`  finished renders to copy: ${copied} of ${doneTotal} unfiled${skips.length ? ` · not filed: ${skips.join(", ")}` : ""}\n`);
    fileTotal += copied;
  } catch (err) {
    console.log(`  error: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
console.log(`# ${scoped.length} events · ${folderTotal} folders ${apply ? "created" : "to create"} · ${fileTotal} files ${apply ? "copied" : "to copy"}`);
