// scripts/ad-library-ingest.mts
//
// E9's interim ingest: the weekly Claude task's Ad Library reads (the Meta Ads
// connector's `ads_library_search`) into ad_library_ads (migration 265).
// Graph `ads_archive` refuses this app and covers EU delivery only (PR #1354),
// so the task reads through the connector and writes through this script.
//
// Dry run by default: reads the stored rows (SELECT only) and prints what it
// would insert and change, and which ads have run 30 days or more (long
// runners, the winner signal without spend). --apply writes the inserts and
// changed rows only, so re-ingesting a file is a no-op and a later file moves
// last_seen forward. --apply refuses to run until migration 265 is applied;
// this script never creates a table.
//
// File shape: lib/ad-library/connector.ts (fetched_at + each call's query and
// the connector's verbatim response). Only ad_active_status ACTIVE calls are
// taken. Ads from pages not on ad_library_pages, or inactive there, are
// skipped and listed.
//
// --seed loads the watchlist (ad_library_pages) from a seed file instead.
// Its --apply refuses until the file says "confirmed": true.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/ad-library-ingest.mts --file reads.json [--apply]
//   npx tsx --env-file=.env.local scripts/ad-library-ingest.mts --seed scripts/ad-library-seed.json [--apply]

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { mergeSeen, parseIngestFile } from "../lib/ad-library/connector.ts";
import { loadPages, loadStoredAds, tablesMissing, writeAds, writePages, type Db } from "../lib/ad-library/db.ts";
import { parseSeed, planIngest, planPages, type PageRow, type WatchedPage } from "../lib/ad-library/ingest.ts";

const DEFAULT_SEED = "scripts/ad-library-seed.json";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const FILE = arg("--file");
const SEED = arg("--seed");
if (!FILE === !SEED) throw new Error("Pass exactly one of --file <reads.json> or --seed <seed.json>");

function cell(value: unknown): string {
  return String(value ?? "–").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function refuseMissing(missing: string[]): never {
  console.error(`Migration 265 is not applied: ${missing.join(", ")} missing. Apply supabase/migrations/265_ad_library.sql first. This script never creates tables.`);
  process.exit(1);
}

async function runSeed(db: Db, missing: string[]): Promise<void> {
  const stored = missing.length ? new Map<string, PageRow>() : await loadPages(db);
  const seed = parseSeed(readFileSync(SEED!, "utf8"), new Set(stored.keys()));
  const plan = planPages(seed.pages, stored);
  console.log(`Seed ${SEED}: ${seed.pages.length} pages · insert ${plan.inserts.length} · update ${plan.updates.length} · unchanged ${plan.unchanged} · confirmed ${seed.confirmed}`);
  if (missing.length) console.log(`(${missing.join(", ")} not there yet: every page reads as an insert.)`);
  console.log("\n| Page id | Name | Kind | Derived from | Active | Change |\n|---|---|---|---|---|---|");
  for (const row of plan.inserts) console.log(`| ${row.page_id} | ${cell(row.name)} | ${row.kind} | ${cell(row.derived_from_page_id)} | ${row.active} | insert |`);
  for (const u of plan.updates) console.log(`| ${u.row.page_id} | ${cell(u.row.name)} | ${u.row.kind} | ${cell(u.row.derived_from_page_id)} | ${u.row.active} | ${u.changed.join(", ")} |`);
  if (!APPLY) return console.log("\nDry run: nothing written. --apply writes.");
  if (missing.length) refuseMissing(missing);
  if (!seed.confirmed) {
    console.error('The seed is not confirmed. Matas sets "confirmed": true after checking the list.');
    process.exit(1);
  }
  const written = await writePages(db, [...plan.inserts, ...plan.updates.map((u) => u.row)]);
  console.log(`\nWrote ${written} pages.`);
}

async function runIngest(db: Db, missing: string[]): Promise<void> {
  if (APPLY && missing.length) refuseMissing(missing);
  const file = parseIngestFile(readFileSync(FILE!, "utf8"));
  const seen = mergeSeen(file.calls);

  let watchlist: Map<string, WatchedPage>;
  if (missing.length) {
    const seed = parseSeed(readFileSync(DEFAULT_SEED, "utf8"));
    watchlist = new Map(seed.pages.map((p) => [p.page_id, { pageId: p.page_id, name: p.name, kind: p.kind, active: p.active }]));
    console.log(`(${missing.join(", ")} not there yet: watchlist from ${DEFAULT_SEED}, every ad reads as an insert.)`);
  } else {
    const pages = await loadPages(db);
    watchlist = new Map([...pages.values()].map((p) => [p.page_id, { pageId: p.page_id, name: p.name, kind: p.kind, active: p.active }]));
  }
  const stored = missing.length ? new Map() : await loadStoredAds(db, seen.map((a) => a.adArchiveId));
  const plan = planIngest({ seen, seenOn: file.seenOn, stored, watchlist });
  const name = (pageId: string) => watchlist.get(pageId)?.name ?? pageId;

  console.log(`File ${FILE}: fetched ${file.fetchedAt} (seen on ${file.seenOn}) · ${file.calls.length} calls read · ${file.skipped.length} skipped · ${seen.length} ads`);
  console.log(`insert ${plan.inserts.length} · update ${plan.updates.length} · unchanged ${plan.unchanged} · off the watchlist ${plan.offWatchlist.length} · long runners ${plan.longRunners.length}`);
  for (const s of file.skipped) console.log(`  skipped call ${s.index}: ${s.reason}`);
  for (const c of file.calls) console.log(`  call ${c.index}: ${c.pageIds.map(name).join(", ")} · ${c.countries.join(",")} · ${c.ads.length} ads of ~${c.estimatedTotal ?? "?"}`);

  if (plan.inserts.length) {
    console.log("\nInserts\n\n| Ad | Page | Start | Countries | Title |\n|---|---|---|---|---|");
    for (const r of plan.inserts) console.log(`| ${r.ad_archive_id} | ${cell(name(r.page_id))} | ${cell(r.start_date)} | ${r.countries.join(",")} | ${cell(r.link_title)} |`);
  }
  if (plan.updates.length) {
    console.log("\nUpdates\n\n| Ad | Page | Changed | last_seen |\n|---|---|---|---|");
    for (const u of plan.updates) console.log(`| ${u.row.ad_archive_id} | ${cell(name(u.row.page_id))} | ${u.changed.join(", ")} | ${u.row.last_seen} |`);
  }
  if (plan.offWatchlist.length) {
    console.log("\nSkipped (off the watchlist)\n");
    for (const o of plan.offWatchlist) console.log(`- ${o.ad.adArchiveId} · ${cell(o.ad.pageName)} (${o.ad.pageId}) · ${o.reason}`);
  }
  console.log(`\nLong runners (start → last seen ≥ 30 days): ${plan.longRunners.length}`);
  for (const l of plan.longRunners) console.log(`- long_runner ${l.adArchiveId} · ${cell(name(l.pageId))} · ${l.startDate} → ${l.lastSeen} · ${l.liveDays} days · ${cell(l.linkTitle)}`);

  if (!APPLY) return console.log("\nDry run: nothing written. --apply writes.");
  const written = await writeAds(db, [...plan.inserts, ...plan.updates.map((u) => u.row)]);
  console.log(`\nWrote ${written} ads.`);
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const missing = await tablesMissing(db);
  if (SEED) await runSeed(db, missing);
  else await runIngest(db, missing);
}

await main();
