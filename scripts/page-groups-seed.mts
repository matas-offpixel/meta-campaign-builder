/**
 * Seed the Similar tier's genre page groups (page_groups, migration 275;
 * staged two-campaign record). A dry run unless --apply.
 *
 * Reads PR B's per-client listing (#1400: loadClientBuildableSources in
 * lib/mcp/audiences/client-sources.ts — every Facebook Page and Instagram
 * account the client's business can build engagement audiences from, owned
 * or client-shared, with its genre_family when known) and plans one group
 * per client and genre. A source with no known genre is counted and said,
 * never guessed; on prod today none has one, so expect no groups yet.
 * Only clients whose Business Manager is linked are listed (4 of 9, 26 Nov).
 *
 * --from-meta calls loadClientBuildableSources for every client with a linked
 * Business Manager (client_business_managers), as Matas (MATAS_USER_IDS, or
 * --user): Meta GETs only, through the audience tools' own deps. --listing
 * FILE takes its rows from a file instead (an array of { client_id, kind, id,
 * name, genre_family, reach }), with no Meta call.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/page-groups-seed.mts --from-meta            # dry run: prints the plan
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/page-groups-seed.mts --from-meta --apply    # writes new and changed unconfirmed groups
 *   … --listing FILE in place of --from-meta · … --client UUID for one client
 *
 * --genres FILE (Matas, 27 Nov): the page genres file
 * (scratch/retargeting/page-genres-draft-*.csv), only its rows Matas marked
 * "confirmed" (CONFIRMED_STATUS) with a genre that isn't "?". Each Page goes
 * under every client its Business Manager is linked to. Run it only once he
 * has confirmed the file; a dry run first.
 *
 *   npx tsx --env-file=.env.local scripts/page-groups-seed.mts --genres FILE           # dry run
 *   npx tsx --env-file=.env.local scripts/page-groups-seed.mts --genres FILE --apply
 *
 * Venue and promoter Pages (venues.meta_page_id, clients.default_page_ids)
 * never join a group (TC9), whatever their row says.
 *
 * --apply never confirms a group and never touches a confirmed one: Matas
 * confirms each before the build uses it. Prints ids and counts only.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { MATAS_USER_IDS } from "../lib/auth/operator-allowlist.ts";
import { confirmedGenreRows, loadVenueAndPromoterPageIds, noGenreLine, parseGenreRows, planPageGroups, sourcesFromGenreRows, type ClientBuildableSource, type StoredGroup } from "../lib/retargeting/page-groups.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const LISTING = arg("--listing");
const FROM_META = process.argv.includes("--from-meta");
const GENRES = arg("--genres");
const CLIENT = arg("--client");
const USER = arg("--user") ?? MATAS_USER_IDS[0];
if (!LISTING && !FROM_META && !GENRES) throw new Error("--genres FILE, --from-meta or --listing FILE is required");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (--env-file=.env.local)");
const db = createClient(url, key, { auth: { persistSession: false } });
// TC9: venue and promoter Pages never join a group.
const venueOrPromoter = await loadVenueAndPromoterPageIds(db);

/** #1400's listing for every client with a linked Business Manager (Meta GETs as Matas). */
async function fromMeta(): Promise<ClientBuildableSource[]> {
  if (!USER) throw new Error("--user UUID is required (MATAS_USER_IDS is empty)");
  const { realAudienceDeps } = await import("../lib/mcp/audience-deps.ts");
  const { loadClientBuildableSources } = await import("../lib/mcp/audiences/client-sources.ts");
  const deps = realAudienceDeps(db as never);
  const { data, error } = await db.from("client_business_managers").select("client_id, business_id").not("client_id", "is", null);
  if (error) throw new Error(`client_business_managers: ${error.message}`);
  const rows: ClientBuildableSource[] = [];
  for (const link of (data ?? []) as { client_id: string; business_id: string }[]) {
    if (CLIENT && link.client_id !== CLIENT) continue;
    try {
      rows.push(...(await loadClientBuildableSources(db as never, deps, USER, link.client_id, String(link.business_id))));
    } catch {
      console.error(`not read: client=${link.client_id} business=${link.business_id}`);
    }
  }
  return rows;
}

/** The confirmed rows of the genres file, under the clients their Business Manager links to. */
async function fromGenres(): Promise<ClientBuildableSource[]> {
  const rows = parseGenreRows(readFileSync(GENRES!, "utf8"));
  const confirmed = confirmedGenreRows(rows);
  const { data, error } = await db.from("client_business_managers").select("client_id, business_name").not("client_id", "is", null);
  if (error) throw new Error(`client_business_managers: ${error.message}`);
  const { sources, unlinked, leftOut } = sourcesFromGenreRows(rows, (data ?? []) as { client_id: string; business_name: string | null }[], { venueOrPromoter });
  console.log(`genres file: rows=${rows.length} confirmed=${confirmed.length} ignored=${rows.length - confirmed.length} (draft, unsure, "?" or not a genre to group on) venue_or_promoter_left_out=${leftOut}`);
  for (const name of unlinked) console.log(`no client links business "${name}": its confirmed pages are left out`);
  return sources;
}

const listing = (GENRES ? await fromGenres() : FROM_META ? await fromMeta() : (JSON.parse(readFileSync(LISTING!, "utf8")) as ClientBuildableSource[])).filter((row) => !CLIENT || row.client_id === CLIENT);
const clientIds = [...new Set(listing.map((row) => row.client_id))];
const stored: StoredGroup[] = [];
for (let i = 0; i < clientIds.length; i += 100) {
  const { data, error } = await db.from("page_groups").select("id, client_id, genre_family, page_ids, ig_ids, confirmed_at").in("client_id", clientIds.slice(i, i + 100));
  if (error) throw new Error(`page_groups: ${error.message}`);
  stored.push(...((data ?? []) as StoredGroup[]));
}

const { plan, counts } = planPageGroups(listing, stored, { venueOrPromoter });
for (const count of counts) if (count.noGenre) console.log(noGenreLine(count));
for (const row of plan) console.log(`${row.action.padEnd(15)} client=${row.clientId} genre=${row.genreFamily} pages=${row.pageIds.length} instagram=${row.igIds.length}`);
const actions = plan.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.action]: (acc[row.action] ?? 0) + 1 }), {});
console.log(`groups=${plan.length} ${Object.entries(actions).map(([k, v]) => `${k}=${v}`).join(" ")} ${APPLY ? "apply" : "dry run"}`);

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
