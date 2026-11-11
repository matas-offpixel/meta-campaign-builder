/**
 * D6 of docs/design-record/2026-11-11-creative-lab-drive-owner-type.html, done
 * in place (Matas, 11 Nov): the client already holds the link to the cycle's
 * Content folder, so its {owner} / Videos | Statics folders stay where they
 * are and are recorded in the folder map under D5's keys
 * (lib/drive/owner-map.ts). Later filings for that cycle land inside the link.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/drive-owner-type-migrate.mts --event P26-BDAY
 *   node --env-file=.env.local --experimental-strip-types scripts/drive-owner-type-migrate.mts --event P26-BDAY --apply
 *
 * Dry run by default: SELECTs against Supabase and listings on the Shared
 * Drive only. --apply writes drive_folders rows, nothing else. Map only: it
 * cannot move, make, rename, trash or share anything — there is no such call
 * in it. Safe to run twice: a second --apply records nothing new.
 */

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../lib/db/database.types.ts";
import { driveFromEnv } from "../lib/drive/client.ts";
import type { DriveDb } from "../lib/drive/db.ts";
import { formatOwnerMapLine, mapOwnerTypeInPlace } from "../lib/drive/owner-map.ts";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const code = argv[argv.indexOf("--event") + 1];
if (!argv.includes("--event") || !code) {
  console.error("--event CODE is required");
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient<Database>(url, key, { auth: { persistSession: false } });
const { drive, reason } = driveFromEnv();
if (!drive) {
  console.error(`The export drive is not configured: ${reason}`);
  process.exit(2);
}

const eventRes = await db.from("events").select("id, name, event_code, client_id, drive_folder_id").eq("event_code", code).maybeSingle();
if (eventRes.error || !eventRes.data) {
  console.error(`No event with code ${code}: ${eventRes.error?.message ?? "not found"}`);
  process.exit(2);
}
const event = eventRes.data;
const clientRes = await db.from("clients").select("id, name").eq("id", event.client_id).maybeSingle();
if (clientRes.error || !clientRes.data) {
  console.error(`No client for ${code}: ${clientRes.error?.message ?? "not found"}`);
  process.exit(2);
}
if (!event.drive_folder_id) {
  console.log(`${code} has no Drive folder: nothing to map.`);
  process.exit(0);
}

console.log(`# Drive owner/type map, in place ${apply ? "APPLY — drive_folders rows only" : "DRY RUN — nothing recorded"} · ${code} · ${event.name} · client ${clientRes.data.name}`);
const result = await mapOwnerTypeInPlace(db as unknown as DriveDb, drive, event, clientRes.data, { apply });
for (const line of result.lines) console.log(formatOwnerMapLine(line));
console.log(`# ${result.mappings} mappings ${apply ? "recorded" : "to record"} · ${result.moves} moves`);
