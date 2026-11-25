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
 * --held-tsv PATH writes every held file nothing accounts for, with its
 * suggested owner (suggest.ts; proposals only, never written), and prints
 * them grouped by client × suggested owner. --compare-held PATH (an older
 * held TSV, artist in column 1) prints held files before → after per artist.
 * The general bucket (ads on a billed show that name no artist) is printed
 * per show.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { artistAnswer } from "../lib/artist-library/answer.ts";
import {
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
import { heldNoSourceFiles, suggestOwner, type HeldFile, type Suggestion } from "../lib/artist-library/suggest.ts";
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
const compareHeld = values("--compare-held")[0] ?? null;
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

const wanted = only.length ? inputs.artists.filter((a) => only.some((n) => a.name === n || fold(a.name) === fold(n))) : inputs.artists;
for (const n of only) if (!wanted.some((a) => fold(a.name) === fold(n))) console.log(`no artist called "${n}"`);

const clientName = new Map(inputs.clients.map((c) => [c.id, c.name]));
const eventOf = eventCode ? inputs.events.find((e) => e.event_code === eventCode) ?? null : null;
let totalRows = 0;
const plans: ArtistPlan[] = [];
const held: (HeldFile & Suggestion)[] = [];
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
  for (const h of heldNoSourceFiles(plan.rows, artist.name)) {
    const ev = h.eventId ? eventById.get(h.eventId) : undefined;
    held.push({ ...h, ...suggestOwner(h, { venueNames: [ev?.venue_name, clientName.get(h.clientId ?? "")] }) });
  }
  const shareableFiles = view.groups.filter((g) => g.shareable).length;
  console.log(`\n${artist.name} (${artist.id})`);
  console.log(`  rows: ${plan.rows.length} · ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(" · ")} · matched by ${Object.entries(byMatch).map(([k, n]) => `${k} ${n}`).join(", ")} (named in the ad name ${byField.ad}, the ad set name ${byField.adset})`);
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
console.log(`\ngeneral bucket (ads naming no artist, on shows with a bill): ${general.reduce((s, g) => s + g.ads, 0)} ads on ${general.length} shows`);
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
  }
}

// ─── Held files nothing accounts for, with a suggested owner (never written) ─
if (heldTsv) {
  const order: Record<string, number> = { promoter: 0, artist: 1, unsure: 2 };
  const showOf = (h: HeldFile) => (h.eventId ? eventById.get(h.eventId)?.event_code ?? "" : "");
  const sorted = [...held].sort(
    (a, b) =>
      (clientName.get(a.clientId ?? "") ?? "").localeCompare(clientName.get(b.clientId ?? "") ?? "") ||
      order[a.owner]! - order[b.owner]! ||
      a.artistName.localeCompare(b.artistName) ||
      a.file.localeCompare(b.file),
  );
  const lines = ["client\tsuggested_owner\twhy\tartist\tfile\tkind\tshow\tads\tconfirm (promoter / artist / offpixel)"];
  for (const h of sorted) lines.push([clientName.get(h.clientId ?? "") ?? "?", h.owner, h.why, h.artistName, h.file.replace(/\t/g, " "), h.kind, showOf(h), h.ads, ""].join("\t"));
  writeFileSync(heldTsv, `${lines.join("\n")}\n`);
  console.log(`\nheld files nothing accounts for: ${held.length} (suggestions only; nothing written) → ${heldTsv}`);
  const groups = new Map<string, (HeldFile & Suggestion)[]>();
  for (const h of sorted) {
    const k = `${clientName.get(h.clientId ?? "") ?? "?"}\u0000${h.owner}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(h);
  }
  for (const [k, items] of groups) {
    const [client, owner] = k.split("\u0000");
    const examples = [...new Set(items.map((i) => i.file))].slice(0, 4).join(" · ");
    console.log(`  ${client} · ${owner}: ${items.length} files · ${new Set(items.map((i) => i.artistId)).size} artists · e.g. ${examples}`);
  }
}

if (compareHeld) {
  const before = new Map<string, number>();
  for (const line of readFileSync(compareHeld, "utf8").split("\n").slice(1)) {
    const artist = line.split("\t")[0];
    if (artist) before.set(artist, (before.get(artist) ?? 0) + 1);
  }
  const after = new Map<string, number>();
  for (const h of held) after.set(h.artistName, (after.get(h.artistName) ?? 0) + 1);
  const names = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => (before.get(b) ?? 0) - (before.get(a) ?? 0) || a.localeCompare(b));
  const total = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + n, 0);
  console.log(`\nheld files before → after (${compareHeld}): ${total(before)} → ${total(after)} across ${before.size} → ${after.size} artists`);
  for (const n of names) console.log(`  ${n}: ${before.get(n) ?? 0} → ${after.get(n) ?? 0}`);
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
