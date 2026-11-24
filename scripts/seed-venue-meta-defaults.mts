// scripts/seed-venue-meta-defaults.mts
//
// R2's venue card values (migration 266): each venue's Meta ad account and
// pixel, read from what the app's own launches ran on. The single source of
// venue account / pixel values: nothing is typed in or taken from a design
// frame. lib/replicate/venue-seed.ts does the planning (see its header for
// the rules).
//
// Dry run by default: SELECTs only, prints the plan. Writes nothing.
//   --apply                writes venues (insert or fill empty values) and
//                          links the client's events to them (events.venue_id
//                          where it's null). Refuses until migration 266 is applied.
//   --overwrite            with --apply, also replaces a venue value that differs.
//   --event-overrides      with --apply, also writes events.meta_pixel_id for the
//                          proposed event overrides.
//   --clear-client-pixel   with --apply, sets clients.meta_pixel_id to null
//                          (R2, overnight Task 5 §5 B). Matas decides.
//   --city "key=City"      a venue city when the events don't carry one
//                          (venues.city is not null). Repeatable.
//   --client <uuid>        default: Electric (f9045034-2788-4b1d-94d1-1a5ab7fa5ac8).
//
// Usage:
//   npx tsx --env-file=.env.local scripts/seed-venue-meta-defaults.mts
//   npx tsx --env-file=.env.local scripts/seed-venue-meta-defaults.mts --apply --city "electric bristol=Bristol"

import { createClient } from "@supabase/supabase-js";

import { normalizeAdAccountId } from "../lib/meta/ad-account.ts";
import { planVenueSeed, type SeedAdSet, type SeedEvent, type SeedVenueRow, type Tally } from "../lib/replicate/venue-seed.ts";

const ELECTRIC = "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8";
const PAGE = 1000;
const CHUNK = 100;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === name && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
}

const APPLY = process.argv.includes("--apply");
const OVERWRITE = process.argv.includes("--overwrite");
const EVENT_OVERRIDES = process.argv.includes("--event-overrides");
const CLEAR_CLIENT_PIXEL = process.argv.includes("--clear-client-pixel");
const CLIENT = arg("--client") ?? ELECTRIC;
const CITIES = new Map(args("--city").map((s) => [s.split("=")[0]!.trim().toLowerCase(), s.split("=").slice(1).join("=").trim()]));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (--env-file=.env.local)");
const db = createClient(url, key, { auth: { persistSession: false } });

type Row = Record<string, unknown>;

/** The query-builder calls these reads use. */
interface Q {
  eq(col: string, value: unknown): Q;
  in(col: string, values: unknown[]): Q;
  ilike(col: string, pattern: string): Q;
  order(col: string): Q;
  range(from: number, to: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

async function paged(table: string, cols: string, build: (q: Q) => Q): Promise<Row[]> {
  const out: Row[] = [];
  for (let at = 0; ; at += PAGE) {
    const { data, error } = await build(db.from(table).select(cols) as unknown as Q).range(at, at + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as Row[]));
    if ((data as Row[]).length < PAGE) return out;
  }
}

async function chunked(table: string, cols: string, col: string, values: string[], order: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    out.push(...(await paged(table, cols, (q) => q.in(col, values.slice(i, i + CHUNK)).order(order))));
  }
  return out;
}

async function has266(): Promise<boolean> {
  const { error } = await db.from("venues").select("client_id, meta_ad_account_id, meta_pixel_id").limit(1);
  if (!error) return true;
  if (error.code === "42703" || /does not exist/i.test(error.message)) return false;
  throw new Error(`venues: ${error.message}`);
}

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const money = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cell = (v: unknown) => String(v ?? "–").replace(/\|/g, "\\|");

async function main(): Promise<void> {
  const applied = await has266();
  const { data: client, error: clientError } = await db.from("clients").select("id, name, status, meta_ad_account_id, meta_pixel_id").eq("id", CLIENT).maybeSingle();
  if (clientError || !client) throw new Error(`client ${CLIENT}: ${clientError?.message ?? "not found"}`);

  const eventCols = `id, user_id, event_code, venue_name, venue_city, venue_id, event_date, meta_ad_account_id${applied ? ", meta_pixel_id" : ""}`;
  const events = (await paged("events", eventCols, (q) => q.eq("client_id", CLIENT).order("id"))).map(
    (r): SeedEvent => ({
      id: String(r.id),
      user_id: s(r.user_id),
      event_code: s(r.event_code),
      venue_name: s(r.venue_name),
      venue_city: s(r.venue_city),
      venue_id: s(r.venue_id),
      event_date: s(r.event_date),
      meta_ad_account_id: s(r.meta_ad_account_id),
      meta_pixel_id: s(r.meta_pixel_id),
    }),
  );
  const eventIds = events.map((e) => e.id);

  const launched = await chunked("launched_ad_sets", "meta_adset_id, event_id, ad_account_id, draft_id", "event_id", eventIds, "meta_adset_id");
  const draftIds = [...new Set(launched.map((r) => s(r.draft_id)).filter((v): v is string => Boolean(v)))];
  const draftPixel = new Map<string, string | null>();
  for (const r of await chunked("campaign_drafts", "id, mp:draft_json->settings->>metaPixelId, p:draft_json->settings->>pixelId", "id", draftIds, "id")) {
    draftPixel.set(String(r.id), s(r.mp) ?? s(r.p));
  }
  const adsetIds = [...new Set(launched.map((r) => String(r.meta_adset_id)))];
  const spend = new Map<string, number>();
  for (const r of await chunked("ad_daily_insights", "id, meta_adset_id, spend", "meta_adset_id", adsetIds, "id")) {
    const k = String(r.meta_adset_id);
    spend.set(k, (spend.get(k) ?? 0) + Number(r.spend ?? 0));
  }
  const seen = new Set<string>();
  const adSets: SeedAdSet[] = [];
  for (const r of launched) {
    const id = String(r.meta_adset_id);
    if (seen.has(id)) continue;
    seen.add(id);
    adSets.push({
      meta_adset_id: id,
      event_id: String(r.event_id),
      ad_account_id: s(r.ad_account_id),
      pixel_id: draftPixel.get(String(r.draft_id)) ?? null,
      spend: spend.get(id) ?? 0,
    });
  }

  // Events with no launched ad sets: the latest draft's pixel.
  const withLaunch = new Set(adSets.map((a) => a.event_id));
  const draftPixelByEvent: Record<string, string> = {};
  const quiet = eventIds.filter((id) => !withLaunch.has(id));
  for (const r of await chunked("campaign_drafts", "id, event_id, updated_at, mp:draft_json->settings->>metaPixelId, p:draft_json->settings->>pixelId", "event_id", quiet, "updated_at")) {
    const px = s(r.mp) ?? s(r.p);
    if (px) draftPixelByEvent[String(r.event_id)] = px; // ordered by updated_at: the last one wins
  }

  const venues: SeedVenueRow[] = applied
    ? (await paged("venues", "id, name, meta_ad_account_id, meta_pixel_id", (q) => q.eq("client_id", CLIENT).order("id"))).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        meta_ad_account_id: s(r.meta_ad_account_id),
        meta_pixel_id: s(r.meta_pixel_id),
      }))
    : [];

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const plan = planVenueSeed({ clientId: CLIENT, events, adSets, draftPixelByEvent, venues, today });

  // Names, for reading the table only.
  const acts = [...new Set(plan.venues.flatMap((v) => [v.account, ...v.accountOthers].map((t) => t?.value)).filter((v): v is string => Boolean(v)))];
  const pixels = [
    ...new Set(
      [...plan.venues.flatMap((v) => [v.pixel, ...v.pixelOthers].map((t) => t?.value)), ...plan.overrides.map((o) => o.pixel), s(client.meta_pixel_id)].filter((v): v is string => Boolean(v)),
    ),
  ];
  const accountName = new Map((await chunked("bm_ad_accounts", "ad_account_id, name", "ad_account_id", acts, "ad_account_id")).map((r) => [normalizeAdAccountId(s(r.ad_account_id)), s(r.name)]));
  const pixelName = new Map((await chunked("bm_pixels", "pixel_id, name", "pixel_id", pixels, "pixel_id")).map((r) => [s(r.pixel_id), s(r.name)]));
  const brixtonPixels = await paged("bm_pixels", "pixel_id, name", (q) => q.ilike("name", "%brixton%").order("pixel_id"));

  const named = (t: Tally | null, names: Map<string | null, string | null>) => (t ? `${t.value} (${names.get(t.value) ?? "?"})` : "not set");
  const behind = (t: Tally | null) => (t ? `${t.adSets} ad sets · ${money(t.spend)}` : "no launched ad sets");

  console.log(`Client ${client.name} (${CLIENT}) · ${events.length} events · ${adSets.length} launched ad sets · ${money(adSets.reduce((n, a) => n + a.spend, 0))} spend (ad_daily_insights, all time)`);
  console.log(`Migration 266: ${applied ? "applied" : "NOT applied (venue rows and values read as none; --apply refuses)"}\n`);

  console.log("| Venue | Venue id | Ad account | Account source | Behind it | Pixel | Pixel source | Behind it |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const v of plan.venues) {
    console.log(
      `| ${cell(v.name)}${v.city ? `, ${cell(v.city)}` : ""} | ${v.existing?.id ?? "new row"} | ${named(v.account, accountName)} | launched_ad_sets.ad_account_id by spend | ${behind(v.account)} | ${named(v.pixel, pixelName)} | launching draft's settings.metaPixelId, in that account, by spend | ${behind(v.pixel)} |`,
    );
  }
  const brixtonKnown = plan.venues.some((v) => /brixton/.test(v.key));
  if (!brixtonKnown) {
    console.log(`| Electric Brixton | none | not set | no event at this venue | no launched ad sets | not set | no event at this venue | no launched ad sets |`);
  }

  console.log("\nAlso ran (≥ 10 % of the winner's spend), and the events' own account column:");
  for (const v of plan.venues) {
    const a = v.accountOthers.map((t) => `${named(t, accountName)} ${behind(t)}`).join("; ") || "none";
    const p = v.pixelOthers.map((t) => `${named(t, pixelName)} ${behind(t)}`).join("; ") || "none";
    const ev = v.eventAccounts.map((x) => `${x.value} on ${x.events} events`).join("; ") || "none set";
    console.log(`- ${v.name}: accounts ${a} · pixels ${p} · events.meta_ad_account_id ${ev} · ${v.eventsToLink.length}/${v.events} events to link`);
  }
  if (!brixtonKnown) {
    console.log(`- Electric Brixton: no events, no ad sets. In the BM, not written: ${brixtonPixels.map((r) => `${r.pixel_id} (${r.name})`).join("; ") || "none"}.`);
  }

  console.log("\nEvent pixel overrides proposed (upcoming events whose own pixel isn't the venue's):");
  if (!plan.overrides.length) console.log("- none");
  console.log(plan.overrides.length ? "| Event | Venue | Pixel | Source | Behind it | events.meta_pixel_id now |\n|---|---|---|---|---|---|" : "");
  for (const o of plan.overrides) {
    console.log(`| ${o.code} | ${o.venueKey} | ${o.pixel} (${pixelName.get(o.pixel) ?? "?"}) | ${o.source === "draft" ? "latest draft's settings.metaPixelId" : "its launched ad sets"} | ${o.source === "draft" ? "no launched ad sets" : `${o.adSets} ad sets · ${money(o.spend)}`} | ${o.current ?? (applied ? "null" : "column not there yet")} |`);
  }

  const clientPixel = s(client.meta_pixel_id);
  console.log(`\nclients.meta_pixel_id: ${clientPixel ? `${clientPixel} (${pixelName.get(clientPixel) ?? "?"})` : "null"}. R2: set to null (--clear-client-pixel). clients.meta_ad_account_id: ${s(client.meta_ad_account_id) ?? "null"} (not changed).`);

  if (!APPLY) return console.log("\nDry run: nothing written. Matas confirms, then --apply.");
  if (!applied) {
    console.error("Migration 266 is not applied. Apply supabase/migrations/266_campaign_creator_replicate.sql first. This script never creates columns.");
    process.exit(1);
  }

  for (const v of plan.venues) {
    const values = { meta_ad_account_id: v.account?.value ?? null, meta_pixel_id: v.pixel?.value ?? null };
    let venueId = v.existing?.id ?? null;
    if (!venueId) {
      const city = v.city ?? CITIES.get(v.key) ?? null;
      if (!city || !v.userId) {
        console.error(`Skipped ${v.name}: ${!city ? `no city (pass --city "${v.key}=City")` : "no event owner"}.`);
        continue;
      }
      const { data, error } = await db.from("venues").insert({ user_id: v.userId, client_id: CLIENT, name: v.name, city, ...values }).select("id").single();
      if (error) throw new Error(`venues insert ${v.name}: ${error.message}`);
      venueId = String(data.id);
      console.log(`Inserted venue ${v.name} ${venueId}.`);
    } else {
      const patch: Record<string, string> = {};
      for (const [k, val] of Object.entries(values)) {
        const now = (v.existing as unknown as Record<string, string | null>)[k];
        if (val && (now == null || (OVERWRITE && now !== val))) patch[k] = val;
      }
      if (Object.keys(patch).length) {
        const { error } = await db.from("venues").update(patch).eq("id", venueId);
        if (error) throw new Error(`venues update ${v.name}: ${error.message}`);
        console.log(`Updated venue ${v.name}: ${Object.keys(patch).join(", ")}.`);
      }
    }
    for (let i = 0; i < v.eventsToLink.length; i += CHUNK) {
      const { error } = await db.from("events").update({ venue_id: venueId }).in("id", v.eventsToLink.slice(i, i + CHUNK)).is("venue_id", null);
      if (error) throw new Error(`events link ${v.name}: ${error.message}`);
    }
    console.log(`Linked ${v.eventsToLink.length} events to ${v.name}.`);
  }
  if (EVENT_OVERRIDES) {
    for (const o of plan.overrides) {
      const { error } = await db.from("events").update({ meta_pixel_id: o.pixel }).eq("id", o.eventId).is("meta_pixel_id", null);
      if (error) throw new Error(`events override ${o.code}: ${error.message}`);
      console.log(`Set ${o.code} events.meta_pixel_id = ${o.pixel}.`);
    }
  }
  if (CLEAR_CLIENT_PIXEL) {
    const { error } = await db.from("clients").update({ meta_pixel_id: null }).eq("id", CLIENT);
    if (error) throw new Error(`clients: ${error.message}`);
    console.log("Set clients.meta_pixel_id = null.");
  }
}

await main();
