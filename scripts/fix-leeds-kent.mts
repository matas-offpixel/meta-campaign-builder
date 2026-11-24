/**
 * Swap "Leeds, Kent" (Meta city key 811209) for a Leeds city-centre pin on
 * four live campaigns, and take the Kent entry out of the app's drafts.
 * Approved by Matas 24 Nov 2026: "update the campaigns to swap for correct leeds".
 *
 *   npx tsx --env-file=/Users/liebus/meta-campaign-builder/.env.local scripts/fix-leeds-kent.mts             # dry run (default)
 *   npx tsx --env-file=/Users/liebus/meta-campaign-builder/.env.local scripts/fix-leeds-kent.mts --apply     # write
 *
 * Why: 811209 is "Leeds, Kent" (+80 km covers Kent and SE London). Meta's
 * adgeolocation search has no city "Leeds" in West Yorkshire, only
 * neighbourhoods, so the pin is a custom location instead.
 *
 * --dry-run (default) Meta GETs only (campaigns, their ad sets with targeting). Supabase reads only. Prints, per ad
 *   set: id, name, status, cities before → after, custom_locations after, and
 *   the check that nothing else in targeting changed. Then the drafts plan.
 * --apply  Per changed ad set, one at a time: ledger row
 *   (`adset_targeting_update`, key adset id + "leeds_kent_swap", required),
 *   POST /{adset_id} { targeting }, read back and confirm. Stops at the first
 *   Meta error. Then the drafts, each UPDATE guarded on the updated_at read.
 *
 * --skip-ended  An ad set whose end_time (read live this run) has passed, or
 *   whose effective_status is COMPLETED, can't take a targeting
 *   write (Meta 100/3858750 "Ad set has ended"). Without this flag such an ad
 *   set is refused in the plan, so --apply sends nothing. With it, ended ad
 *   sets are listed as skipped and left as they are (no end-date change).
 *
 * Token: META_ACCESS_TOKEN (the operator token). Never a client token, never
 * printed. This runs outside the app route, so
 * OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED is not involved.
 *
 * Writes nothing but `targeting` on the ad sets listed by the dry run, the
 * ledger rows, and `campaign_drafts.draft_json` / `updated_at` on the drafts
 * that carry 811209. No status, budget, creative or audience change.
 */

import { createClient } from "@supabase/supabase-js";

import { withMetaWriteIdempotency, type MetaWriteContext } from "../lib/meta/write-idempotency.ts";

const KENT_KEY = "811209";
const LEDGER_TAG = "leeds_kent_swap";
const PIN = {
  latitude: 53.7997,
  longitude: -1.5492,
  radius: 80,
  distance_unit: "kilometer",
  name: "Leeds",
} as const;

const CAMPAIGNS = [
  { id: "120252733824740755", account: "606252931141334", label: "[NX27-PAULVANDYK] On sale" },
  { id: "120252643592150755", account: "606252931141334", label: "[NX27-PAULVANDYK] Signup" },
  { id: "120252675731800755", account: "606252931141334", label: "[NX27-GLITTERBOX] SIGNUP" },
  { id: "120251951114800239", account: "1073273492854557", label: "[ES27-LPRHYTHM] On Sale" },
] as const;

const apply = process.argv.includes("--apply");
const skipEnded = process.argv.includes("--skip-ended");
const NOW = Date.now();
for (const a of process.argv.slice(2)) {
  if (a !== "--apply" && a !== "--dry-run" && a !== "--skip-ended") throw new Error(`unknown argument ${a}`);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const token = process.env.META_ACCESS_TOKEN;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (!token) throw new Error("META_ACCESS_TOKEN is required");
const supabase = createClient(url, key, { auth: { persistSession: false } });
const BASE = `https://graph.facebook.com/${process.env.META_API_VERSION ?? "v21.0"}`;

const calls = { get: 0, post: 0 };

type Json = Record<string, unknown>;

class MetaError extends Error {
  constructor(public detail: Json) {
    super(
      `Meta error ${String(detail.code ?? "")}/${String(detail.error_subcode ?? "")}: ${String(detail.message ?? "")}` +
        (detail.error_user_title ? ` · ${String(detail.error_user_title)}` : "") +
        (detail.error_user_msg ? ` · ${String(detail.error_user_msg)}` : ""),
    );
  }
}

async function graphGet(path: string, params: Record<string, string> = {}): Promise<Json> {
  const qs = new URLSearchParams({ ...params, access_token: token! });
  calls.get += 1;
  const res = await fetch(`${BASE}/${path}?${qs}`);
  const body = (await res.json()) as Json;
  if (!res.ok || body.error) throw new MetaError((body.error as Json) ?? { message: `HTTP ${res.status}` });
  return body;
}

async function graphGetUrl(next: string): Promise<Json> {
  // Paging URLs carry the token Meta echoes back; never printed.
  calls.get += 1;
  const res = await fetch(next);
  const body = (await res.json()) as Json;
  if (!res.ok || body.error) throw new MetaError((body.error as Json) ?? { message: `HTTP ${res.status}` });
  return body;
}

async function graphPost(path: string, form: Record<string, string>): Promise<Json> {
  const body = new URLSearchParams({ ...form, access_token: token! });
  calls.post += 1;
  const res = await fetch(`${BASE}/${path}`, { method: "POST", body });
  const json = (await res.json()) as Json;
  if (!res.ok || json.error) throw new MetaError((json.error as Json) ?? { message: `HTTP ${res.status}` });
  return json;
}

// ─── Targeting ──────────────────────────────────────────────────────────────

type City = { key: string; name?: string; radius?: number; distance_unit?: string; region?: string; country?: string };

function asObj(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}
function asList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function idOf(e: unknown): string | null {
  if (typeof e === "string" || typeof e === "number") return String(e);
  const id = asObj(e).id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

/** Read-only fields dropped and audience objects reduced to {id}. Same meaning, writable shape. */
function normalise(targeting: Json): { out: Json; dropped: string[] } {
  const out = structuredClone(targeting);
  const dropped: string[] = [];
  for (const k of Object.keys(out)) {
    if (k.startsWith("effective_") || k === "dt_consolidation_state") {
      dropped.push(k);
      delete out[k];
    }
  }
  for (const k of ["custom_audiences", "excluded_custom_audiences"]) {
    if (Array.isArray(out[k])) out[k] = (out[k] as unknown[]).map((e) => ({ id: idOf(e) }));
  }
  return { out, dropped };
}

function isPin(c: unknown): boolean {
  const o = asObj(c);
  return (
    Math.abs(Number(o.latitude) - PIN.latitude) < 0.001 &&
    Math.abs(Number(o.longitude) - PIN.longitude) < 0.001 &&
    Number(o.radius) === PIN.radius
  );
}

function swap(targeting: Json): Json {
  const next = structuredClone(targeting);
  const geo = asObj(next.geo_locations);
  geo.cities = asList(geo.cities).filter((c) => (c as City).key !== KENT_KEY);
  if (!(geo.cities as unknown[]).length) delete geo.cities;
  const custom = asList(geo.custom_locations);
  if (!custom.some(isPin)) custom.push({ ...PIN });
  geo.custom_locations = custom;
  next.geo_locations = geo;
  return next;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Json)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Json)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Paths whose value differs, outside geo_locations.cities and geo_locations.custom_locations. */
function otherDiffs(before: Json, after: Json): string[] {
  const strip = (t: Json): Json => {
    const c = structuredClone(t);
    const g = asObj(c.geo_locations);
    delete g.cities;
    delete g.custom_locations;
    c.geo_locations = g;
    return c;
  };
  const a = strip(before);
  const b = strip(after);
  const out: string[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === "geo_locations") {
      const ga = asObj(a[k]);
      const gb = asObj(b[k]);
      for (const gk of new Set([...Object.keys(ga), ...Object.keys(gb)])) {
        if (stable(ga[gk]) !== stable(gb[gk])) out.push(`geo_locations.${gk}`);
      }
    } else if (stable(a[k]) !== stable(b[k])) out.push(k);
  }
  return out;
}

function cityKeys(t: Json): string[] {
  return asList(asObj(t.geo_locations).cities).map((c) => String((c as City).key));
}
function cityLabel(t: Json): string {
  return (
    asList(asObj(t.geo_locations).cities)
      .map((c) => {
        const city = c as City;
        return `${city.name ?? "?"} ${city.key}${city.radius ? ` +${city.radius}${city.distance_unit === "mile" ? "mi" : "km"}` : ""}`;
      })
      .join("; ") || "—"
  );
}
function idSet(t: Json, k: string): string {
  return asList(t[k])
    .map(idOf)
    .filter((x): x is string => !!x)
    .sort()
    .join(",");
}

// ─── Overlap note ───────────────────────────────────────────────────────────

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(lat2 - lat1);
  const dLon = r(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * City-centre coordinates for the cities these ad sets carry. Meta's
 * adgeolocationmeta search returns no latitude / longitude for a city key,
 * so the overlap note uses this fixed table; a city not in it says so.
 */
const coords = new Map<string, { lat: number; lon: number; name: string }>([
  ["805149", { lat: 54.8925, lon: -2.9329, name: "Carlisle" }],
  ["807493", { lat: 55.9533, lon: -3.1883, name: "Edinburgh" }],
  ["813386", { lat: 54.9783, lon: -1.6178, name: "Newcastle upon Tyne" }],
  ["812810", { lat: 54.5742, lon: -1.235, name: "Middlesbrough" }],
  ["813758", { lat: 52.9548, lon: -1.1581, name: "Nottingham" }],
  ["815879", { lat: 53.3811, lon: -1.4701, name: "Sheffield" }],
]);

function overlapNote(after: Json): string {
  const notes: string[] = [];
  const geo = asObj(after.geo_locations);
  for (const c of asList(geo.cities) as City[]) {
    const at = coords.get(String(c.key));
    if (!at) {
      notes.push(`${c.name ?? c.key}: no coordinates`);
      continue;
    }
    const r = c.radius ? (c.distance_unit === "mile" ? c.radius * 1.609344 : c.radius) : 0;
    const d = km(PIN.latitude, PIN.longitude, at.lat, at.lon);
    if (d < PIN.radius + r) notes.push(`overlaps ${c.name ?? c.key} (${Math.round(d)} km apart, radii 80 + ${Math.round(r)})`);
  }
  const ex = asObj(geo.excluded_geo_locations);
  for (const c of asList(ex.cities) as City[]) {
    const at = coords.get(String(c.key));
    if (!at) {
      notes.push(`excluded ${c.name ?? c.key}: no coordinates`);
      continue;
    }
    const r = c.radius ? (c.distance_unit === "mile" ? c.radius * 1.609344 : c.radius) : 0;
    const d = km(PIN.latitude, PIN.longitude, at.lat, at.lon);
    if (d < PIN.radius + r) notes.push(`overlaps EXCLUDED ${c.name ?? c.key} (${Math.round(d)} km)`);
  }
  for (const k of ["regions", "countries", "zips", "custom_locations", "places", "geo_markets"]) {
    if (asList(ex[k]).length) notes.push(`excluded ${k}: ${asList(ex[k]).length} (not measured)`);
  }
  return notes.join("; ") || "none";
}

// ─── Read ───────────────────────────────────────────────────────────────────

interface Plan {
  campaignId: string;
  campaignLabel: string;
  account: string;
  adSetId: string;
  name: string;
  status: string;
  effectiveStatus: string;
  endTime: string | null;
  ended: boolean;
  before: Json;
  after: Json;
  dropped: string[];
  others: string[];
  overlap: string;
  refuse: string | null;
}

async function readCampaign(c: (typeof CAMPAIGNS)[number]): Promise<{ plans: Plan[]; skipped: number; total: number }> {
  const camp = await graphGet(c.id, { fields: "id,name,account_id,effective_status" });
  if (String(camp.account_id) !== c.account) {
    throw new Error(`campaign ${c.id} is on account ${String(camp.account_id)}, not ${c.account}`);
  }
  const rows: Json[] = [];
  let page = await graphGet(`${c.id}/adsets`, {
    fields: "id,name,campaign_id,account_id,status,effective_status,end_time,targeting",
    limit: "100",
  });
  for (;;) {
    rows.push(...(asList(page.data) as Json[]));
    const next = asObj(page.paging).next;
    if (typeof next !== "string") break;
    page = await graphGetUrl(next);
  }
  const plans: Plan[] = [];
  for (const r of rows) {
    const raw = asObj(r.targeting);
    if (!cityKeys(raw).includes(KENT_KEY)) continue;
    const { out: before, dropped } = normalise(raw);
    const after = swap(before);
    const others = otherDiffs(before, after);
    let refuse: string | null = null;
    if (String(r.campaign_id) !== c.id) refuse = `campaign_id ${String(r.campaign_id)} ≠ ${c.id}`;
    else if (String(r.account_id) !== c.account) refuse = `account ${String(r.account_id)} ≠ ${c.account}`;
    else if (others.length) refuse = `diff touches ${others.join(", ")}`;
    else if (["ARCHIVED", "DELETED"].includes(String(r.effective_status))) refuse = `${String(r.effective_status)}`;
    const endTime = typeof r.end_time === "string" ? r.end_time : null;
    // Decided per run from this read: end_time passed, or Meta already calls it completed.
    const ended =
      (endTime !== null && Date.parse(endTime) <= NOW) ||
      ["COMPLETED", "ADSET_COMPLETED"].includes(String(r.effective_status));
    if (!refuse && ended && !skipEnded) refuse = `ended ${endTime} (Meta refuses targeting writes; --skip-ended leaves it)`;
    else if (idSet(raw, "custom_audiences") !== idSet(after, "custom_audiences")) refuse = "custom audiences would change";
    else if (idSet(raw, "excluded_custom_audiences") !== idSet(after, "excluded_custom_audiences")) refuse = "exclusions would change";
    plans.push({
      campaignId: c.id,
      campaignLabel: c.label,
      account: c.account,
      adSetId: String(r.id),
      name: String(r.name ?? ""),
      status: String(r.status ?? ""),
      effectiveStatus: String(r.effective_status ?? ""),
      endTime,
      ended,
      before,
      after,
      dropped,
      others,
      overlap: "",
      refuse,
    });
  }
  return { plans, skipped: rows.length - plans.length, total: rows.length };
}

// ─── Drafts ─────────────────────────────────────────────────────────────────

interface DraftPlan {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  before: number;
  next: Json;
  changes: string[];
  refuse: string | null;
}

function countKent(v: unknown): number {
  if (typeof v === "string") return v === KENT_KEY || v.startsWith(`city:${KENT_KEY}:`) ? 1 : 0;
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + countKent(x), 0);
  if (v && typeof v === "object") return Object.values(v as Json).reduce<number>((n, x) => n + countKent(x), 0);
  return 0;
}

function isKentSel(s: unknown): boolean {
  return asObj(s).locationKey === KENT_KEY;
}

/**
 * LocationSelection has no custom pin (no latitude / longitude; launch's
 * pushSelection writes cities, regions, countries and country groups only),
 * so the Kent entry is removed, with every reference to it.
 */
function fixDraft(draft: Json): { next: Json; changes: string[]; refuse: string | null } {
  const next = structuredClone(draft);
  const changes: string[] = [];
  const bs = asObj(next.budgetSchedule);
  const removedGroups = new Set<string>();
  const groups = asList(bs.locationGroups).map((g) => asObj(g));
  const keptGroups: Json[] = [];
  for (const g of groups) {
    const sels = asList(g.selections);
    const kent = sels.filter(isKentSel);
    if (!kent.length) {
      keptGroups.push(g);
      continue;
    }
    const rest = sels.filter((s) => !isKentSel(s));
    if (rest.length) {
      g.selections = rest;
      keptGroups.push(g);
      changes.push(`budgetSchedule.locationGroups[${String(g.id)}]: −${kent.length} Kent selection`);
    } else {
      removedGroups.add(String(g.id));
      changes.push(`budgetSchedule.locationGroups: −group ${String(g.id)} (${String(g.label ?? "")})`);
    }
  }
  if (Array.isArray(bs.locationGroups)) bs.locationGroups = keptGroups;
  if (Array.isArray(bs.excludedLocations)) {
    const ex = asList(bs.excludedLocations);
    const keep = ex.filter((s) => !isKentSel(s));
    if (keep.length !== ex.length) {
      bs.excludedLocations = keep;
      changes.push(`budgetSchedule.excludedLocations: −${ex.length - keep.length}`);
    }
  }
  if (next.budgetSchedule !== undefined) next.budgetSchedule = bs;

  let refuse: string | null = null;
  const adSets = asList(next.adSetSuggestions).map((a) => asObj(a));
  adSets.forEach((a, i) => {
    const label = `adSetSuggestions[${i}]`;
    if (Array.isArray(a.locationGroupIds)) {
      const ids = a.locationGroupIds as unknown[];
      const keep = ids.filter((id) => !removedGroups.has(String(id)));
      if (keep.length !== ids.length) {
        if (!keep.length) refuse = `${label} "${String(a.name ?? "")}" would have no locations`;
        a.locationGroupIds = keep;
        changes.push(`${label}.locationGroupIds: −${ids.length - keep.length}`);
      }
    }
    if (typeof a.locationGroupId === "string" && removedGroups.has(a.locationGroupId)) {
      refuse = `${label} legacy locationGroupId points at the Kent group`;
    }
    const geo = asObj(a.geoLocations);
    for (const part of [geo, asObj(geo.excluded_geo_locations)]) {
      if (Array.isArray(part.cities)) {
        const cs = part.cities as unknown[];
        const keep = cs.filter((c) => String(asObj(c).key) !== KENT_KEY);
        if (keep.length !== cs.length) {
          part.cities = keep;
          changes.push(`${label}.geoLocations${part === geo ? "" : ".excluded_geo_locations"}.cities: −${cs.length - keep.length}`);
        }
      }
    }
  });
  if (Array.isArray(next.adSetSuggestions)) next.adSetSuggestions = adSets;
  const left = countKent(next);
  if (left && !refuse) refuse = `${left} reference(s) to ${KENT_KEY} left after the fix`;
  return { next, changes, refuse };
}

async function readDrafts(): Promise<DraftPlan[]> {
  const out: DraftPlan[] = [];
  // Every draft, any status (≈ 300 rows): PostgREST can't filter on draft_json::text.
  const pageSize = 50;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("campaign_drafts")
      .select("id,name,status,updated_at,draft_json")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`drafts read: ${error.message}`);
    for (const row of data ?? []) {
      const draft = asObj(row.draft_json);
      const before = countKent(draft);
      if (!before) continue; // 811209 only inside another id
      const { next, changes, refuse } = fixDraft(draft);
      out.push({
        id: row.id,
        name: row.name ?? "",
        status: row.status ?? "",
        updatedAt: row.updated_at,
        before,
        next,
        changes,
        refuse,
      });
    }
    if (!data || data.length < pageSize) break;
  }
  return out;
}

// ─── Ledger context ─────────────────────────────────────────────────────────

const ledgerCache = new Map<string, MetaWriteContext>();
async function ledgerFor(campaignId: string): Promise<MetaWriteContext> {
  const hit = ledgerCache.get(campaignId);
  if (hit) return hit;
  const { data, error } = await supabase
    .from("campaign_drafts")
    .select("id,user_id,event_id,created_at")
    .eq("draft_json->>metaCampaignId", campaignId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error || !data?.length) throw new Error(`no draft for campaign ${campaignId} (ledger needs one)`);
  const ctx: MetaWriteContext = {
    supabase: supabase as unknown as MetaWriteContext["supabase"],
    userId: data[0].user_id,
    draftId: data[0].id,
    eventId: data[0].event_id,
  };
  ledgerCache.set(campaignId, ctx);
  return ctx;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const all: Plan[] = [];
for (const c of CAMPAIGNS) {
  const { plans, skipped, total } = await readCampaign(c);
  console.log(`campaign ${c.id} ${c.label} act_${c.account}: ${total} ad sets, ${plans.length} carry ${KENT_KEY}, ${skipped} don't`);
  all.push(...plans);
}

for (const p of all) p.overlap = overlapNote(p.after);

console.log("\n## Ad sets\n");
console.log("| campaign | ad set | name | status | cities before | cities after | custom_locations after | other targeting changed | overlap | end | ready |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const p of all) {
  const custom = asList(asObj(p.after.geo_locations).custom_locations)
    .map((x) => {
      const o = asObj(x);
      return `${String(o.name ?? "pin")} ${String(o.latitude)},${String(o.longitude)} +${String(o.radius)}km`;
    })
    .join("; ");
  console.log(
    `| ${p.campaignId} | ${p.adSetId} | ${p.name} | ${p.status}/${p.effectiveStatus} | ${cityLabel(p.before)} | ${cityLabel(p.after)} | ${custom} | ${p.others.length ? p.others.join(", ") : "nothing"} | ${p.overlap} | ${p.endTime ?? "none"} | ${p.refuse ? `NO: ${p.refuse}` : p.ended ? "skip (ended)" : "yes"} |`,
  );
}
console.log("\n## Ended: left on Leeds, Kent\n");
console.log("| campaign | ad set | name | status | end_time | cities kept |");
console.log("|---|---|---|---|---|---|");
for (const p of all.filter((x) => x.ended)) {
  console.log(`| ${p.campaignId} | ${p.adSetId} | ${p.name} | ${p.status}/${p.effectiveStatus} | ${p.endTime ?? "none"} | ${cityLabel(p.before)} |`);
}
if (!all.some((x) => x.ended)) console.log("| — | none | | | | |");
const dropped = [...new Set(all.flatMap((p) => p.dropped))];
console.log(`\nRead-only keys dropped before the write: ${dropped.join(", ") || "none"}. Audience lists sent as {id} only.`);

const drafts = await readDrafts();
console.log("\n## Drafts\n");
console.log("| draft | status | name | 811209 refs | changes | ready |");
console.log("|---|---|---|---|---|---|");
for (const d of drafts) {
  console.log(`| ${d.id} | ${d.status} | ${d.name} | ${d.before} | ${d.changes.join("; ")} | ${d.refuse ? `NO: ${d.refuse}` : "yes"} |`);
}

const refused = all.filter((p) => p.refuse);
const skipped = all.filter((p) => !p.refuse && p.ended);
console.log(`\nAd sets: ${all.length} carry ${KENT_KEY}, ${all.length - refused.length - skipped.length} ready, ${skipped.length} skipped (ended), ${refused.length} refused.`);
console.log(`Drafts: ${drafts.length} carry ${KENT_KEY}, ${drafts.filter((d) => !d.refuse).length} ready.`);

if (!apply) {
  console.log(`\nDry run. Meta calls: ${calls.get} GET, ${calls.post} POST.`);
  process.exit(0);
}

if (refused.length) {
  console.log("\nRefused ad sets present: nothing applied. Stop and report.");
  console.log(`Meta calls: ${calls.get} GET, ${calls.post} POST.`);
  process.exit(1);
}

console.log("\n## Apply\n");
let failed: string | null = null;
for (const p of all) {
  if (p.ended) {
    console.log(`${p.adSetId} skipped: ended ${p.endTime}`);
    continue;
  }
  const ctx = await ledgerFor(p.campaignId);
  try {
    let wrote = false;
    await withMetaWriteIdempotency(
      ctx,
      "adset_targeting_update",
      { adset_id: p.adSetId, change: LEDGER_TAG },
      async () => {
        wrote = true;
        await graphPost(p.adSetId, { targeting: JSON.stringify(p.after) });
        return p.adSetId;
      },
      { required: true },
    );
    console.log(`${p.adSetId} ${wrote ? "written" : "already on the ledger, not re-sent"} (ledger draft ${ctx.draftId})`);
  } catch (err) {
    failed = `${p.adSetId} ${p.name}: ${err instanceof Error ? err.message : String(err)}`;
    console.log(`STOP at ${failed}`);
    break;
  }

  const back = await graphGet(p.adSetId, { fields: "id,campaign_id,targeting" });
  const t = asObj(back.targeting);
  const kentGone = !cityKeys(t).includes(KENT_KEY);
  const pinThere = asList(asObj(t.geo_locations).custom_locations).some(isPin);
  const citiesSame = cityKeys(t).sort().join(",") === cityKeys(p.after).sort().join(",");
  const caSame = idSet(t, "custom_audiences") === idSet(p.before, "custom_audiences");
  const exSame = idSet(t, "excluded_custom_audiences") === idSet(p.before, "excluded_custom_audiences");
  const ok = kentGone && pinThere && citiesSame && caSame && exSame;
  console.log(
    `  read-back ${p.adSetId}: 811209 gone ${kentGone} · pin ${pinThere} · other cities same ${citiesSame} · custom audiences same ${caSame} · exclusions same ${exSame} → ${ok ? "OK" : "MISMATCH"}`,
  );
  if (!ok) {
    failed = `${p.adSetId} read-back mismatch`;
    console.log(`STOP at ${failed}`);
    break;
  }
}

if (failed) {
  console.log(`\nMeta stopped; drafts not touched. Meta calls: ${calls.get} GET, ${calls.post} POST.`);
  process.exit(1);
}

console.log("\n## Drafts apply\n");
for (const d of drafts) {
  if (d.refuse) {
    console.log(`${d.id} skipped: ${d.refuse}`);
    continue;
  }
  const { data, error } = await supabase
    .from("campaign_drafts")
    .update({ draft_json: d.next, updated_at: new Date().toISOString() })
    .eq("id", d.id)
    .eq("updated_at", d.updatedAt)
    .select("id");
  if (error) console.log(`${d.id} failed: ${error.message}`);
  else if (!data?.length) console.log(`${d.id} not updated: edited since the read (updated_at moved)`);
  else console.log(`${d.id} updated (${d.changes.length} changes)`);
}

console.log(`\nMeta calls: ${calls.get} GET, ${calls.post} POST.`);
