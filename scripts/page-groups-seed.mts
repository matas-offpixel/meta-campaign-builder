/**
 * Seed the Similar tier's genre page groups (page_groups, migration 275;
 * staged two-campaign record). A dry run unless --apply.
 *
 * Reads the audience-source listing (every Page / Instagram account each
 * client's business can build engagement audiences from, with its genre)
 * and plans one group per client and genre. SWITCH(Job 2): until PR B's
 * listing lands, the listing is a JSON file (--listing FILE), an array of
 * { clientId, pageId, igId, name, genreFamily, canBuild }.
 *
 *   npx tsx --env-file=.env.local scripts/page-groups-seed.mts --listing FILE            # dry run: prints the plan
 *   npx tsx --env-file=.env.local scripts/page-groups-seed.mts --listing FILE --apply    # writes new and changed unconfirmed groups
 *   … --client UUID                                                                      # one client
 *
 * --apply never confirms a group and never touches a confirmed one: Matas
 * confirms each before the build uses it. Prints ids and counts only.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { planPageGroups, type ListedSource, type StoredGroup } from "../lib/retargeting/page-groups.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const LISTING = arg("--listing");
const CLIENT = arg("--client");
if (!LISTING) throw new Error("--listing FILE is required until the audience-source listing lands (SWITCH(Job 2))");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (--env-file=.env.local)");
const db = createClient(url, key, { auth: { persistSession: false } });

const listing = (JSON.parse(readFileSync(LISTING, "utf8")) as ListedSource[]).filter((row) => !CLIENT || row.clientId === CLIENT);
const clientIds = [...new Set(listing.map((row) => row.clientId))];
const stored: StoredGroup[] = [];
for (let i = 0; i < clientIds.length; i += 100) {
  const { data, error } = await db.from("page_groups").select("id, client_id, genre_family, page_ids, ig_ids, confirmed_at").in("client_id", clientIds.slice(i, i + 100));
  if (error) throw new Error(`page_groups: ${error.message}`);
  stored.push(...((data ?? []) as StoredGroup[]));
}

const plan = planPageGroups(listing, stored);
for (const row of plan) console.log(`${row.action.padEnd(15)} client=${row.clientId} genre=${row.genreFamily} pages=${row.pageIds.length} instagram=${row.igIds.length}`);
const counts = plan.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.action]: (acc[row.action] ?? 0) + 1 }), {});
console.log(`groups=${plan.length} ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")} ${APPLY ? "apply" : "dry run"}`);

if (APPLY) {
  for (const row of plan.filter((r) => r.action === "insert" || r.action === "update")) {
    // Guarded: a group confirmed since the read is never rewritten.
    const write = row.action === "insert"
      ? await db.from("page_groups").insert({ client_id: row.clientId, genre_family: row.genreFamily, page_ids: row.pageIds, ig_ids: row.igIds, source: "seed" })
      : await db.from("page_groups").update({ page_ids: row.pageIds, ig_ids: row.igIds, updated_at: new Date().toISOString() }).eq("client_id", row.clientId).eq("genre_family", row.genreFamily).is("confirmed_at", null);
    if (write.error) console.error(`failed client=${row.clientId} genre=${row.genreFamily}: ${write.error.message}`);
  }
  console.log("applied (unconfirmed; Matas confirms each group before it's used)");
}
