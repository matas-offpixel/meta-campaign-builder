/**
 * The artist library's backfill (AL2, migration 269).
 *
 *   npx tsx --env-file=.env.local scripts/artist-library-backfill.mts --artist "Enzo Siragusa"
 *   npx tsx --env-file=.env.local scripts/artist-library-backfill.mts
 *   npx tsx --env-file=.env.local scripts/artist-library-backfill.mts --artist "Enzo Siragusa" --apply
 *
 * Dry run by default: reads prod (service role, paged), writes nothing,
 * calls no Meta, Drive or anything else. Spend and results come from
 * ad_daily_insights. Prints per artist: assets by kind, the shareable count,
 * shows, the top 5 by stage (with each one's rights) and the Renders
 * shortcuts the Drive library would get. Counts, ids and file names only.
 *
 * --apply upserts the rows into artist_assets (on artist_id, asset_key);
 * it needs migration 269 applied. It never touches Drive or Meta.
 * --artist NAME (repeatable) narrows to those artists; without it every
 * artist with at least one asset is printed. --event CODE prints the
 * get_artist answer for that event too.
 */
import { createClient } from "@supabase/supabase-js";

import { artistAnswer } from "../lib/artist-library/answer.ts";
import { loadBackfillInputs, planArtistAssets, writeArtistAssets, type ArtistPlan } from "../lib/artist-library/backfill.ts";
import { planShortcuts, type RankedRender } from "../lib/artist-library/library-tree.ts";
import { fold } from "../lib/artist-library/match.ts";
import { buildArtistView } from "../lib/artist-library/view.ts";
import { costWords, RANKED_STAGES, STAGE_LABEL, type RankedStage } from "../lib/artist-library/words.ts";
import { londonToday } from "../lib/drive/tree.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const values = (name: string) => argv.flatMap((arg, index) => (arg === name && argv[index + 1] ? [argv[index + 1]!] : []));

const apply = flag("--apply");
const only = values("--artist");
const eventCode = values("--event")[0] ?? null;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (use --env-file=.env.local).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const now = new Date();
const today = londonToday(now);

const started = Date.now();
const inputs = await loadBackfillInputs(db);
console.log(`read: ${inputs.artists.length} artists · ${inputs.events.length} events · ${inputs.ads.length} ads over ${inputs.insights.length} ad-days · ${inputs.clips.length} Lab clips · ${inputs.renders.length} Lab renders · ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(apply ? "mode: --apply (artist_assets only; no Drive, no Meta)" : "mode: dry run (nothing written)");

const wanted = only.length ? inputs.artists.filter((a) => only.some((n) => a.name === n || fold(a.name) === fold(n))) : inputs.artists;
for (const n of only) if (!wanted.some((a) => fold(a.name) === fold(n))) console.log(`no artist called "${n}"`);

const clientName = new Map(inputs.clients.map((c) => [c.id, c.name]));
const eventOf = eventCode ? inputs.events.find((e) => e.event_code === eventCode) ?? null : null;
let totalRows = 0;
const plans: ArtistPlan[] = [];
for (const artist of [...wanted].sort((a, b) => a.name.localeCompare(b.name))) {
  const plan = planArtistAssets(inputs, artist);
  if (!plan.rows.length && !only.length) continue;
  plans.push(plan);
  totalRows += plan.rows.length;
  const adIds = new Set(plan.rows.map((r) => r.meta_ad_id).filter(Boolean));
  const view = buildArtistView({
    assets: plan.rows,
    insights: inputs.insights.filter((r) => adIds.has(r.meta_ad_id)),
    events: inputs.events,
    linkedEventIds: [...inputs.links.filter((l) => l.artist_id === artist.id).map((l) => l.event_id), ...(eventOf ? [eventOf.id] : [])],
    today,
  });
  const byKind: Record<string, number> = {};
  for (const r of plan.rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  const byMatch: Record<string, number> = {};
  for (const r of plan.rows) byMatch[r.matched_by] = (byMatch[r.matched_by] ?? 0) + 1;
  const shareableFiles = view.groups.filter((g) => g.shareable).length;
  console.log(`\n${artist.name} (${artist.id})`);
  console.log(`  rows: ${plan.rows.length} · ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(" · ")} · matched by ${Object.entries(byMatch).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  console.log(`  files: ${view.groups.length} · shareable ${shareableFiles} · held ${view.groups.length - shareableFiles} · skipped: archived ${plan.skipped.archived}, no client ${plan.skipped.noClient}`);
  console.log(`  shows with spend on the artist's ads: ${view.counted.shows} for ${view.counted.clients} clients`);
  for (const s of view.shows) {
    const where = s.adsOnly ? `ads only ${s.adsOnly.first}–${s.adsOnly.last}` : `${s.date ?? "no date"} · ${s.phase ?? ""}`;
    console.log(`    ${s.code} · ${clientName.get(s.clientId ?? "") ?? "?"} · ${where} · £${Math.round(s.spend)} · ${s.signups} signups · ${s.purchases} purchases${s.comingUp ? " · coming up" : ""}`);
  }
  const shortcutInput = {} as Record<RankedStage, RankedRender[]>;
  for (const stage of RANKED_STAGES) {
    const top = view.ranked[stage].slice(0, 5);
    console.log(`  top 5 · ${STAGE_LABEL[stage]}${top.length ? "" : ": none ranked"}`);
    top.forEach((r, i) => {
      const rights = r.group.shareable ? "shareable" : `held · ${clientName.get(r.group.clientId ?? "") ?? "?"} · ${r.group.heldReason}`;
      console.log(`    ${i + 1}. ${r.group.name} · ${r.group.kind} · ${r.group.code ?? "-"} · ${costWords(stage, r.cost)} (shrunk £${r.shrunk.toFixed(2)}) · ${r.ads} ads · ${rights}`);
    });
    shortcutInput[stage] = view.ranked[stage]
      .filter((r) => r.group.kind === "render" && r.group.driveFileId)
      .map((r) => ({ targetId: r.group.driveFileId!, fileName: r.group.name, code: r.group.code ?? "", stage, cost: costWords(stage, r.cost), shareable: r.group.shareable }));
  }
  const shortcuts = planShortcuts(shortcutInput, []);
  console.log(`  Renders shortcuts the library would hold: ${shortcuts.create.length}`);
  for (const c of shortcuts.create) console.log(`    ↪ ${c.name}`);
  if (eventOf) {
    console.log(`\n--- get_artist({ name: ${JSON.stringify(artist.name)}, event: ${JSON.stringify(eventCode)} }) ---`);
    console.log(
      artistAnswer({ artist, view, clientName: (id) => clientName.get(id ?? "") ?? "", event: { code: eventCode!, clientId: eventOf.client_id }, driveFolderId: null, today }),
    );
    console.log("--- end ---");
  }
}

console.log(`\n${plans.length} artists · ${totalRows} rows planned`);
if (apply) {
  const rows = plans.flatMap((p) => p.rows);
  const written = await writeArtistAssets(db, rows, now);
  console.log(`wrote ${written} artist_assets rows`);
}
