/**
 * Duplicate tree folders, read-only (27 Nov). For each event with a Drive
 * folder, lists the folders in its tree that have the same name as a mapped
 * sibling (drive_folders) but aren't in drive_folders themselves: what two
 * runs creating one key at once leave behind. Prints each one's id, name,
 * created time and whether it is empty, beside the mapped folder it copies.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/drive-tree-duplicates.mts --event NX26-RUDIMENTAL
 *   node --env-file=.env.local --experimental-strip-types scripts/drive-tree-duplicates.mts            # every event with a folder
 *
 * There is no --apply: SELECTs on Supabase and files.list / files.get on the
 * Shared Drive only. It never moves, renames, trashes or deletes anything; the
 * Drive handle refuses every write. The app's account can't trash in the
 * shared drive anyway: a duplicate goes to a manager of the drive.
 */

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../lib/db/database.types.ts";

import { driveFromEnv } from "../lib/drive/client.ts";
import { allRows, type DriveDb } from "../lib/drive/db.ts";
import { findTreeDuplicates, readOnlyDrive } from "../lib/drive/duplicates.ts";

const argv = process.argv.slice(2);
const codes = argv.flatMap((arg, i) => (arg === "--event" && argv[i + 1] ? [argv[i + 1]!] : []));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db: DriveDb = createClient<Database>(url, key, { auth: { persistSession: false } });
const { drive: realDrive, reason } = driveFromEnv();
if (!realDrive) {
  console.error(`the export drive isn't configured: ${reason}`);
  process.exit(2);
}
const drive = readOnlyDrive(realDrive);

const events = (await allRows(db, "events")).filter((event) => event.drive_folder_id && (codes.length ? codes.includes(String(event.event_code ?? "")) : true));
for (const code of codes) if (!events.some((event) => event.event_code === code)) console.log(`! ${code}: no event with that code and a Drive folder\n`);

console.log(`# Duplicate tree folders · read-only · ${new Date().toISOString()}\n`);
let total = 0;
for (const event of events) {
  try {
    const scan = await findTreeDuplicates(db, drive, event);
    total += scan.duplicates.length;
    if (!scan.duplicates.length && !codes.length) continue;
    console.log(`## ${event.event_code ?? "—"} · ${event.name} · folders listed ${scan.foldersListed} · duplicates ${scan.duplicates.length}`);
    if (scan.eventFolder) {
      const f = scan.eventFolder;
      console.log(`  event folder ${f.id}  ${JSON.stringify(f.name)}  created ${f.createdTime ?? "?"}  ${f.tagged ? "tagged by the app" : "untagged"}  · drive_folder_linked ${event.drive_folder_linked}`);
    }
    for (const dup of scan.duplicates) {
      console.log(
        `  ${dup.id}  ${JSON.stringify(dup.name)}  created ${dup.createdTime ?? "?"}  ${dup.empty ? "empty" : `holds ${dup.folders} folders, ${dup.files} files`}` +
          `  · mapped ${dup.mapped.key} ${dup.mapped.id} created ${dup.mapped.createdTime ?? "?"}`,
      );
    }
    console.log("");
  } catch (err) {
    console.log(`## ${event.event_code ?? "—"} · error: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
console.log(`# ${events.length} events · ${total} duplicate folders · nothing changed`);
