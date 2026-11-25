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
 * --apply upserts the rows into artist_assets (on artist_id, asset_key)
 * and, in the same run, deletes the artist's stored rows the plan no longer
 * gives them (planRemovals: backfill keys only; never a row of a file the
 * source map makes shareable, never a Drive drop). It needs --artist: the
 * all-artists run is a dry run only. It needs migration 269 applied. It
 * never touches Drive or Meta.
 * --artist NAME (repeatable) narrows to those artists and prints, dry run
 * or not, the stored rows before → after and every removal by name; without
 * it every artist with at least one asset is printed. --event CODE prints
 * the get_artist answer for that event too.
 * --held-tsv PATH writes the held list for reference (held.ts): every held
 * file nothing accounts for, one line per client, artist, show and
 * creative. Nothing is marked or proposed.
 * --summary-tsv PATH writes per artist: rows, ads, files, held files.
 * --compare-summary PATH (an earlier --summary-tsv) prints the artists that
 * changed, before → after.
 * --matches-tsv PATH writes, for the --artist names, every ad matched and
 * how (ad name, ad set name, headliner): ad name, show, client, ad count.
 * Also printed: each confirmed alias's pickup (the ads it adds), shows whose
 * code or name names two artists (no headliner), list ids that aren't
 * artists rows, and the general bucket (ads naming no one on a billed show
 * with no headliner) per show.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { artistAnswer } from "../lib/artist-library/answer.ts";
import { AD_NAME_ONLY, BRANDS } from "../lib/artist-library/aliases.ts";
import {
  adNamesIndex,
  ambiguousHeadliners,
  deleteArtistAssets,
  loadBackfillInputs,
  loadStoredAssets,
  planArtistAssets,
  planGeneral,
  planRemovals,
  writeArtistAssets,
  type ArtistPlan,
  type StoredAsset,
} from "../lib/artist-library/backfill.ts";
import { planShortcuts, type RankedRender } from "../lib/artist-library/library-tree.ts";
import { fold } from "../lib/artist-library/match.ts";
import { heldNoSourceFiles, type HeldFile } from "../lib/artist-library/held.ts";
import { buildArtistView } from "../lib/artist-library/view.ts";
import { costWords, RANKED_STAGES, STAGE_LABEL, type RankedStage } from "../lib/artist-library/words.ts";
import { londonToday } from "../lib/drive/tree.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const values = (name: string) => argv.flatMap((arg, index) => (arg === name && argv[index + 1] ? [argv[index + 1]!] : []));

const apply = flag("--apply");
const only = values("--artist");
const eventCode = values("--event")[0] ?? null;
const heldTsv = values("--held-tsv")[0] ?? null;
const summaryTsv = values("--summary-tsv")[0] ?? null;
const compareSummary = values("--compare-summary")[0] ?? null;
const matchesTsv = values("--matches-tsv")[0] ?? null;
if (apply && !only.length) {
  console.error("--apply needs --artist NAME: the all-artists run is a dry run only.");
  process.exit(1);
}

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
const artistIds = new Set(inputs.artists.map((a) => a.id));
for (const e of [...inputs.aliases.map((a) => ({ id: a.artistId, what: `alias ${a.alias}` })), ...BRANDS.map((b) => ({ id: b.artistId, what: `brand ${b.name}` })), ...AD_NAME_ONLY.map((b) => ({ id: b.artistId, what: `ad-name-only ${b.name}` }))]) {
  if (!artistIds.has(e.id)) console.log(`WARNING: ${e.what} points at ${e.id}, which isn't an artists row`);
}

const wanted = only.length ? inputs.artists.filter((a) => only.some((n) => a.name === n || fold(a.name) === fold(n))) : inputs.artists;
for (const n of only) if (!wanted.some((a) => fold(a.name) === fold(n))) console.log(`no artist called "${n}"`);

const clientName = new Map(inputs.clients.map((c) => [c.id, c.name]));
const eventOf = eventCode ? inputs.events.find((e) => e.event_code === eventCode) ?? null : null;
let totalRows = 0;
const plans: ArtistPlan[] = [];
const held: HeldFile[] = [];
const summary: string[] = ["artist\trows\tads\tfiles\theld_files"];
const { headliners } = adNamesIndex(inputs);
const eventById = new Map(inputs.events.map((e) => [e.id, e]));
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
  const byField = { ad: 0, adset: 0 };
  for (const f of plan.namedIn.values()) byField[f] += 1;
  const heldFiles = heldNoSourceFiles(plan.rows, artist.name);
  held.push(...heldFiles);
  const adRows = plan.rows.filter((r) => r.meta_ad_id).length;
  summary.push([artist.name, plan.rows.length, adRows, 0, heldFiles.length].join("\t"));
  const shareableFiles = view.groups.filter((g) => g.shareable).length;
  summary[summary.length - 1] = [artist.name, plan.rows.length, adRows, view.groups.length, heldFiles.length].join("\t");
  const headlined = inputs.events.filter((e) => headliners.get(e.id)?.artistId === artist.id).map((e) => e.event_code ?? e.id);
  console.log(`\n${artist.name} (${artist.id})`);
  if (headlined.length) console.log(`  headliner of: ${headlined.join(", ")}`);
  console.log(`  rows: ${plan.rows.length} · ads ${adRows} · ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(" · ")} · matched by ${Object.entries(byMatch).map(([k, n]) => `${k} ${n}`).join(", ")} (named in the ad name ${byField.ad}, the ad set name ${byField.adset})`);
  console.log(`  files: ${view.groups.length} · shareable ${shareableFiles} · held ${view.groups.length - shareableFiles} · skipped: archived ${plan.skipped.archived}, no client ${plan.skipped.noClient}`);
  console.log(`  shows with spend on the artist's ads: ${view.counted.shows} for ${view.counted.clients} clients`);
  for (const s of view.shows) {
    const where = s.adsOnly ? `ads only ${s.adsOnly.first}–${s.adsOnly.last}` : `${s.date ?? "no date"} · ${s.phase ?? "no phase"}`;
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

// ─── The general bucket: ads on a billed show that name no artist ──────────
const general = planGeneral(inputs);
console.log(`\ngeneral bucket (ads naming no artist, on billed shows with no headliner): ${general.reduce((s, g) => s + g.ads, 0)} ads on ${general.length} shows`);
for (const g of general.slice(0, only.length ? general.length : 15)) {
  if (only.length && !plans.some((p) => inputs.links.some((l) => l.artist_id === p.artist.id && l.event_id === g.eventId))) continue;
  const top = [...g.files].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f, n]) => `${f} (${n})`).join(" · ");
  console.log(`  ${g.code ?? g.eventId} · ${clientName.get(g.clientId ?? "") ?? "?"} · bill ${g.bill} · ${g.ads} ads · ${g.files.size} files · ${top}`);
}

// ─── Removals: named artists only, printed in the dry run, applied with --apply ─
const counts = (rows: readonly { shareable: boolean }[]) => `${rows.length} (${rows.filter((r) => r.shareable).length} shareable · ${rows.filter((r) => !r.shareable).length} held)`;
const removalsByArtist = new Map<string, StoredAsset[]>();
if (only.length) {
  for (const plan of plans) {
    const stored = await loadStoredAssets(db, plan.artist.id);
    const removals = planRemovals(stored, plan, inputs.sources);
    removalsByArtist.set(plan.artist.id, removals);
    const gone = new Set(removals.map((r) => r.id));
    const plannedKeys = new Set(plan.rows.map((r) => r.asset_key));
    const kept = stored.filter((r) => !gone.has(r.id) && !plannedKeys.has(r.asset_key));
    const storedKeys = new Set(stored.map((r) => r.asset_key));
    const after = [...plan.rows, ...kept];
    console.log(`\n${plan.artist.name}: artist_assets before ${counts(stored)} → after ${counts(after)}`);
    console.log(`  remove ${removals.length} · add ${plan.rows.filter((r) => !storedKeys.has(r.asset_key)).length} · update ${plan.rows.filter((r) => storedKeys.has(r.asset_key)).length} · kept outside the plan ${kept.length}`);
    const byName = new Map<string, number>();
    for (const r of removals) byName.set(`${(r.name ?? r.asset_key).trim()} · ${r.kind}${r.shareable ? " · shareable" : ""}`, (byName.get(`${(r.name ?? r.asset_key).trim()} · ${r.kind}${r.shareable ? " · shareable" : ""}`) ?? 0) + 1);
    for (const [name, n] of [...byName].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) console.log(`    − ${name} × ${n}`);
    const added = new Map<string, number>();
    for (const r of plan.rows.filter((row) => !storedKeys.has(row.asset_key))) {
      const k = `${(r.name ?? r.asset_key).trim()} · ${r.kind} · ${r.matched_by}${r.shareable ? " · shareable" : ""}`;
      added.set(k, (added.get(k) ?? 0) + 1);
    }
    for (const [name, n] of [...added].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) console.log(`    + ${name} × ${n}`);
  }
}

// ─── Shows whose code or name names two artists: no headliner ─────────────
const ambiguous = ambiguousHeadliners(inputs);
const artistName = new Map(inputs.artists.map((a) => [a.id, a.name]));
console.log(`\nshows whose code or name names two or more artists (no headliner): ${ambiguous.length}`);
for (const a of ambiguous) console.log(`  ${a.code ?? a.eventId} · ${a.name ?? ""} · ${a.artistIds.map((id) => artistName.get(id) ?? id).join(" + ")}`);

// ─── Each confirmed alias's pickup: the ad rows it adds ─────────────────────
if (!only.length) {
  console.log("\nconfirmed aliases: ad rows each adds (named, and through a headliner)");
  for (const alias of inputs.aliases) {
    const artist = inputs.artists.find((a) => a.id === alias.artistId);
    if (!artist) continue;
    const without = { ...inputs, aliases: inputs.aliases.filter((a) => a !== alias) };
    const before = new Set(planArtistAssets(without, artist).rows.filter((r) => r.meta_ad_id).map((r) => r.asset_key));
    const added = planArtistAssets(inputs, artist).rows.filter((r) => r.meta_ad_id && !before.has(r.asset_key));
    const viaHeadliner = added.filter((r) => r.matched_by === "event_artists").length;
    const shows = new Set(added.map((r) => r.source_event_id));
    console.log(`  ${alias.alias} = ${artist.name}: +${added.length} ads (${added.length - viaHeadliner} named, ${viaHeadliner} through a headliner) on ${shows.size} shows`);
  }
}

// ─── Every ad matched for the named artists, and how ───────────────────────
if (matchesTsv && only.length) {
  const lines = ["artist\tmatched_as\tcreative\tshow\tclient\tad_names\tads"];
  for (const plan of plans) {
    const by = new Map<string, { as: string; creative: string; show: string; client: string; names: Set<string>; ads: number }>();
    for (const r of plan.rows.filter((row) => row.meta_ad_id)) {
      const field = plan.namedIn.get(r.asset_key);
      const as = r.matched_by === "event_artists" ? "headliner" : field === "adset" ? "ad set name" : r.matched_by === "lab" ? "lab" : r.drive_file_id ? "source map" : "ad name";
      const name = (r.name ?? r.asset_key).trim();
      const creative = name.split(" \u2014 ")[0]!.replace(/\s*[\u2013-]\s*Copy(?:\s+\d+)?$/i, "").trim();
      const show = r.source_event_id ? eventById.get(r.source_event_id)?.event_code ?? "" : "";
      const k = [as, creative, show].join("\u0000");
      const have = by.get(k) ?? by.set(k, { as, creative, show, client: clientName.get(r.source_client_id ?? "") ?? "?", names: new Set(), ads: 0 }).get(k)!;
      have.names.add(name);
      have.ads += 1;
    }
    for (const m of [...by.values()].sort((a, b) => b.ads - a.ads || a.creative.localeCompare(b.creative))) {
      lines.push([plan.artist.name, m.as, m.creative.replace(/\t/g, " "), m.show, m.client, m.names.size, m.ads].join("\t"));
    }
  }
  writeFileSync(matchesTsv, `${lines.join("\n")}\n`);
  console.log(`\nmatched ads for ${plans.map((p) => p.artist.name).join(", ")}: ${lines.length - 1} lines → ${matchesTsv}`);
}

// ─── The held list, for reference (nothing marked or proposed) ─────────────
if (heldTsv) {
  const showOf = (h: HeldFile) => (h.eventId ? eventById.get(h.eventId)?.event_code ?? "" : "");
  const byCreative = new Map<string, { h: HeldFile; names: number; ads: number }>();
  for (const h of held) {
    const k = [h.clientId, h.artistId, h.eventId, h.creative].join("\u0000");
    const have = byCreative.get(k);
    if (have) {
      have.names += 1;
      have.ads += h.ads;
    } else byCreative.set(k, { h, names: 1, ads: h.ads });
  }
  const rows = [...byCreative.values()].sort(
    (a, b) =>
      (clientName.get(a.h.clientId ?? "") ?? "").localeCompare(clientName.get(b.h.clientId ?? "") ?? "") ||
      a.h.artistName.localeCompare(b.h.artistName) ||
      showOf(a.h).localeCompare(showOf(b.h)) ||
      a.h.creative.localeCompare(b.h.creative),
  );
  const lines = ["client\tartist\tcreative\tkind\tshow\tad_names\tads"];
  for (const { h, names, ads } of rows) lines.push([clientName.get(h.clientId ?? "") ?? "?", h.artistName, h.creative.replace(/\t/g, " "), h.kind, showOf(h), names, ads].join("\t"));
  writeFileSync(heldTsv, `${lines.join("\n")}\n`);
  console.log(`\nheld list (this client only; for reference): ${held.length} ad names, ${byCreative.size} creatives → ${heldTsv}`);
}

if (summaryTsv) writeFileSync(summaryTsv, `${summary.join("\n")}\n`);
if (compareSummary) {
  const parse = (text: string) => new Map(text.split("\n").slice(1).filter(Boolean).map((l) => { const [a, ...n] = l.split("\t"); return [a!, n.map(Number)] as const; }));
  const before = parse(readFileSync(compareSummary, "utf8"));
  const after = parse(summary.join("\n"));
  const names = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a.localeCompare(b));
  const z = [0, 0, 0, 0];
  const changed = names.filter((n) => JSON.stringify(before.get(n) ?? z) !== JSON.stringify(after.get(n) ?? z));
  console.log(`\nartists that changed (${compareSummary} → this run): ${changed.length} · rows, ads, files, held files`);
  for (const n of changed) {
    const [r0, a0, f0, h0] = before.get(n) ?? z;
    const [r1, a1, f1, h1] = after.get(n) ?? z;
    console.log(`  ${n}: rows ${r0} → ${r1} · ads ${a0} → ${a1} · files ${f0} → ${f1} · held ${h0} → ${h1}`);
  }
}

if (apply) {
  const rows = plans.flatMap((p) => p.rows);
  const written = await writeArtistAssets(db, rows, now);
  console.log(`\nwrote ${written} artist_assets rows`);
  for (const plan of plans) {
    const removals = removalsByArtist.get(plan.artist.id) ?? [];
    const deleted = await deleteArtistAssets(db, plan.artist.id, removals);
    const stored = await loadStoredAssets(db, plan.artist.id);
    console.log(`${plan.artist.name}: deleted ${deleted} of ${removals.length} · artist_assets now ${counts(stored)}`);
  }
}
