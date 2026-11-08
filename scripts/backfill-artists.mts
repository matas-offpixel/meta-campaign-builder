/**
 * Artist library backfill: recover artist names for every event that has
 * ad copy and link them in event_artists, so the copy normaliser can slot
 * support acts as {artist} and a template can recur across shows.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-artists.mts
 *   npx tsx --env-file=.env.local scripts/backfill-artists.mts --event NX26-MF --event ES26-FEVER105
 *   npx tsx --env-file=.env.local scripts/backfill-artists.mts --assume-confirmed
 *   npx tsx --env-file=.env.local scripts/backfill-artists.mts --apply
 *
 * Dry run by default: reads prod (service role, SELECTs only), prints
 * per event the names recovered with their source and Spotify answer,
 * the rejected candidates with why, then the copy templates before and
 * after (keys, templates on 2+ shows, proven). --apply writes artists and
 * event_artists (source = lineup | ad_copy | campaign_name); it never
 * changes a Lab-written row or a Spotify id already set, and needs
 * migration 212. Spotify confirms every name that is not a Lab lineup
 * name or already in the library; with SPOTIFY_CLIENT_ID /
 * SPOTIFY_CLIENT_SECRET unset those stay unconfirmed and are not written.
 * --assume-confirmed (dry run only) counts them as confirmed to show the
 * ceiling. --max-searches N caps Spotify calls (default: no cap). --json
 * FILE writes the plan and the before/after counts.
 */

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { loadOperatorUserId } from "../lib/learning/runner.ts";
import { loadLearningInputs } from "../lib/learning/joins.ts";
import { artistExtractionInputs, buildCopyLibrary, existingLinks, loadCopySources } from "../lib/learning/copy-performance.ts";
import { spotifyConfirmer } from "../lib/learning/copy/artist-confirm.ts";
import { planArtistLibrary, writeArtistPlan, type ArtistPlan } from "../lib/learning/copy/artist-plan.ts";
import { passesCopyMinimum, PROVEN_INDEX, scoreTemplates, type CopyPerformanceRow } from "../lib/learning/copy/score.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const values = (name: string) => argv.flatMap((arg, index) => (arg === name && argv[index + 1] ? [argv[index + 1]!] : []));

const apply = flag("--apply");
const assumeConfirmed = flag("--assume-confirmed");
const eventCodes = values("--event");
const maxSearches = values("--max-searches")[0] ? Number(values("--max-searches")[0]) : Number.POSITIVE_INFINITY;
const jsonOut = values("--json")[0] ?? null;
if (apply && assumeConfirmed) {
  console.error("--assume-confirmed is for dry runs only");
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const confirm = spotifyConfirmer(process.env);

console.log(`# Artist library backfill ${apply ? "APPLY" : "DRY RUN — nothing written"}${assumeConfirmed ? " (unconfirmed candidates counted as confirmed)" : ""}`);
console.log(`Spotify: ${confirm ? "configured" : "NOT configured — candidates that need it stay unconfirmed and are not written"}\n`);

const inputs = await loadLearningInputs(db);
const sources = await loadCopySources(db);
const extraction = artistExtractionInputs(sources, inputs.facts, inputs.clients, inputs.archivedClientIds, {
  eventCodes: eventCodes.length ? eventCodes : undefined,
});
const plan: ArtistPlan = await planArtistLibrary({ ...extraction, existing: sources.artists, confirm, maxSearches, assumeConfirmed });

console.log(`events with copy: ${extraction.events.length} · library before: ${sources.artists.length} artists, ${sources.memberships.length} links\n`);
console.log("## Per event\n");
for (const report of plan.events) {
  console.log(`### ${report.eventCode ?? "—"} · ${report.eventName ?? "—"} · ${report.ads} ads · recovered ${report.accepted.length}`);
  if (report.alreadyLinked.length) console.log(`  already linked: ${report.alreadyLinked.join(", ")}`);
  for (const link of report.accepted) {
    console.log(`  + ${link.name}${link.isHeadliner ? " (headliner)" : ""} · ${link.source} · ${link.ads} ads · ${via(link.via)}`);
  }
  for (const row of report.spotifyNo) console.log(`  × ${row.name} · ${row.sources.join("+")} · ${row.ads} ads · Spotify: ${row.reason}`);
  for (const row of report.unconfirmed) console.log(`  ? ${row.name} · ${row.sources.join("+")} · ${row.ads} ads · unconfirmed (Spotify not asked)`);
  for (const row of report.rejected) console.log(`  - ${row.name} · ${row.ads} ads · ${row.reason}`);
  console.log("");
}
console.log(`## Totals\n`);
console.log(JSON.stringify({ ...plan.counts, searches: plan.searches, artistsToWrite: plan.artists.filter((a) => !a.existingId).length, spotifyIdsToSet: plan.artists.filter((a) => a.existingId && a.spotify).length, links: plan.links.length }, null, 2));

const before = scoreTemplates(buildCopyLibrary(sources, inputs.facts, inputs.clients).ads);
const after = scoreTemplates(buildCopyLibrary(sources, inputs.facts, inputs.clients, { extraLineups: plan.lineups }).ads);
console.log(`\n## Copy templates before → after (scope all)\n`);
console.log("| | keys | key × field × stage × voice | rows (3 scopes) | events_n ≥ 2 | minimum | proven (index ≤ " + PROVEN_INDEX + ") |");
console.log("|---|---|---|---|---|---|---|");
console.log(`| before | ${summary(before)} |`);
console.log(`| after | ${summary(after)} |`);
const recurring = after.filter((row) => row.scope === "all" && row.events_n >= 2);
if (recurring.length) {
  console.log(`\n## Templates on 2+ shows after\n`);
  for (const row of recurring.sort((a, b) => b.events_n - a.events_n || b.ads_n - a.ads_n)) {
    console.log(`- events=${row.events_n} ads=${row.ads_n} stage=${row.stage} voice=${row.voice} index=${row.index_vs_event} proven=${row.proven}\n    ${JSON.stringify(row.template_key)}`);
  }
}

if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        spotify: plan.spotify,
        assumeConfirmed,
        counts: plan.counts,
        searches: plan.searches,
        events: plan.events,
        artists: plan.artists.map((artist) => ({ name: artist.name, existingId: artist.existingId, spotifyId: artist.spotify?.id ?? null, via: artist.via })),
        before: counts(before),
        after: counts(after),
        recurring: recurring.map((row) => ({ key: row.template_key, events_n: row.events_n, ads_n: row.ads_n, stage: row.stage, voice: row.voice, index: row.index_vs_event, proven: row.proven })),
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${jsonOut}`);
}

if (apply) {
  const userId = await loadOperatorUserId(db);
  const written = await writeArtistPlan(db, plan, { userId, now: new Date().toISOString(), existingLinks: existingLinks(sources), existing: sources.artists });
  console.log(`\n## Written\n`);
  console.log(JSON.stringify(written, null, 2));
}

function via(kind: string): string {
  return kind === "spotify" ? "Spotify: yes" : kind === "known" ? "already in library" : kind === "lineup" ? "Lab lineup" : "assumed (not confirmed)";
}

function counts(rows: readonly CopyPerformanceRow[]) {
  const all = rows.filter((row) => row.scope === "all");
  return {
    keys: new Set(all.map((row) => row.template_key)).size,
    keyFieldStageVoice: all.length,
    rows: rows.length,
    eventsN2: all.filter((row) => row.events_n >= 2).length,
    minimum: all.filter((row) => passesCopyMinimum(row)).length,
    proven: all.filter((row) => row.proven).length,
  };
}

function summary(rows: readonly CopyPerformanceRow[]): string {
  const c = counts(rows);
  return `${c.keys} | ${c.keyFieldStageVoice} | ${c.rows} | ${c.eventsN2} | ${c.minimum} | ${c.proven}`;
}
