/**
 * The on-sale refresh by hand. Dry run by default: reads prod (service
 * role, SELECTs; one Drive listing per cycle type folder), builds every
 * proposal and prints it. Nothing is written — not proposals, not Slack,
 * never Meta. The purchase line reads Meta with META_ACCESS_TOKEN (the
 * delivering ad sets' pixels, pixel names, the pixel's purchases by
 * domain) and one public CIRQLIN page per crqln.com link; every read is
 * counted and printed. Without the token the line says it was not read.
 *
 *   npx tsx --env-file=.env.local scripts/onsale-refresh.mts --event P26-BDAY --shadow 2026-11-12
 *   npx tsx --env-file=.env.local scripts/onsale-refresh.mts --shadow 2026-11-12          # every on-sale event
 *   npx tsx --env-file=.env.local scripts/onsale-refresh.mts --event P26-BDAY --shadow 2026-11-12 --apply
 *   npx tsx --env-file=.env.local scripts/onsale-refresh.mts --shadow 2026-11-13 --purchases                     # HE1's table
 *   npx tsx --env-file=.env.local scripts/onsale-refresh.mts --shadow 2026-11-13 --purchases --also ES26-FEVER105  # plus a show that isn't on sale now
 *
 * --shadow DAY reads the data to the day before (R1's shadow catch-up);
 * without it the run is for today. --apply stores the shadow proposals
 * (and posts to Slack only when notify()'s own gates are open); P1 never
 * applies a line. --json FILE writes the result. --purchases prints HE1's
 * read-only table (docs/design-record/2026-11-13-per-event-purchases.html)
 * for every on-sale event and stops: the resolved pixel, the own domain or
 * why there is none, the purchases on it, the attributed figure, and (HT1
 * of 2026-11-13-ticket-platform-purchases.html) the ticket platform's
 * share of the pixel's purchases, the purchases credited to the show's
 * ads on that pixel from its on-sale date, per campaign and in total, and
 * the state. --also CODE adds a show that is not on sale now.
 */

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { graphGetWithToken } from "../lib/meta/client.ts";
import { graphMultiGetByIds } from "../lib/meta/graph-multi-get.ts";
import { notify } from "../lib/notify/slack.ts";
import { buildLiveNotifyDeps } from "../lib/notify/slack-deps.ts";
import { loadInsights, loadOnSaleEvents, type EventRow } from "../lib/onsale-refresh/load.ts";
import { ONSALE_PHASE } from "../lib/onsale-refresh/phase-config.ts";
import { loadPurchaseReads, type RefreshGraph } from "../lib/onsale-refresh/purchase-read.ts";
import { purchaseWhy, type PurchaseRead } from "../lib/onsale-refresh/purchases.ts";
import { runOnsaleRefresh, type ProposalRecord } from "../lib/onsale-refresh/runner.ts";
import { dayMonth, todayLondon } from "../lib/onsale-refresh/schedule.ts";
import { shortDay, weekLabel } from "../lib/onsale-refresh/schedule.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const values = (name: string) => argv.flatMap((arg, index) => (arg === name && argv[index + 1] ? [argv[index + 1]!] : []));
const apply = flag("--apply");
const shadowDay = values("--shadow")[0];
const eventCodes = values("--event");
const jsonOut = values("--json")[0] ?? null;
const purchasesOnly = flag("--purchases");
const alsoCodes = values("--also");
if (shadowDay && !/^\d{4}-\d{2}-\d{2}$/.test(shadowDay)) {
  console.error("--shadow must be YYYY-MM-DD");
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// Meta reads for the purchase line: one attempt per call, so the printed count is the true cost.
const token = process.env.META_ACCESS_TOKEN;
const graph: RefreshGraph | null = token
  ? { graphGet: (path, params) => graphGetWithToken(path, params, token, { maxAttempts: 1 }), multiGet: (path, params) => graphMultiGetByIds(path, params, token) }
  : null;

if (purchasesOnly) {
  await printPurchaseTable();
  process.exit(0);
}

console.log(`# On-sale refresh ${apply ? "APPLY (shadow proposals stored)" : "DRY RUN — nothing written"}${shadowDay ? ` · shadow run for ${shadowDay}` : ""}\n`);
const result = await runOnsaleRefresh({
  env: { ...process.env, ENABLE_ONSALE_REFRESH: "1" },
  db,
  dryRun: !apply,
  shadowDay,
  eventCodes: eventCodes.length ? eventCodes : undefined,
  notify: apply ? (opts) => notify(opts, buildLiveNotifyDeps(db)) : undefined,
  graph,
  graphReason: token ? undefined : "META_ACCESS_TOKEN is not set",
});
if ("skippedReason" in result) {
  console.log(result);
  process.exit(0);
}

console.log(`day ${result.day} · events ${result.events} · proposals ${result.proposals.length} · Drive calls ${result.driveCalls} · Meta calls ${result.metaCalls} (reads) · CIRQLIN page reads ${result.cirqlinReads}`);
for (const skip of result.skipped) console.log(`skipped: ${skip.eventCode ?? "—"} · ${skip.reason}`);
for (const error of result.errors) console.log(`error: ${error}`);

for (const record of result.proposals) printProposal(record);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(result, null, 2));
  console.log(`\nwrote ${jsonOut}`);
}

function printProposal(record: ProposalRecord): void {
  const { input, proposal, event } = record;
  const plan = input.plan;
  console.log(`\n## ${event.name}${event.event_code ? ` [${event.event_code}]` : ""} · ${input.campaignKey}`);
  console.log(`On-sale refresh · ${weekLabel(plan.cycleMonday)} (${plan.cycleKind} cycle) · ${plan.runKind}`);
  console.log(`Data to ${shortDay(plan.window.end)} (window ${plan.window.start} → ${plan.window.end})${plan.nextCheck ? ` · next: ${shortDay(plan.nextCheck)}` : " · show week next: the refresh stops"}${plan.nextCycle ? ` · next cycle ${shortDay(plan.nextCycle)}` : ""}`);
  console.log(`Shadow${record.written ? ` · stored ${record.proposalId}` : ""} · Slack ${record.slack.sent ? "sent" : `not sent (${record.slack.reason ?? "—"})`}`);
  if (proposal.blockers.length) {
    console.log(`\nBefore it can move money`);
    for (const blocker of proposal.blockers) console.log(`- ${blocker.text} [${blocker.action}]`);
  }
  console.log(`\nObjective${(proposal.why.pixel ?? []).map((line) => `\n[setup] ${line}`).join("")}\n${proposal.why.objective}\n${proposal.why.purchase}${proposal.why.attributed ? `\n${proposal.why.attributed}` : ""} ${proposal.why.moves}${proposal.why.context ? `\n${proposal.why.context}` : ""}${proposal.why.ticketing ? `\n${proposal.why.ticketing}` : ""}`);
  console.log(`393: ${(proposal.why.pixelNarrow ?? []).map((line) => `[setup] ${line} · `).join("")}${proposal.why.purchaseNarrow} ${proposal.why.attributedNarrow ?? ""} ${proposal.why.contextNarrow ?? ""}`);
  console.log(`\n${input.campaignKey} · ${proposal.campaignSummary}`);
  console.log(`Week: £${input.weekSpend.toFixed(2)} · ${input.weekResults} results · budget ${input.budgetGbp == null ? "not set" : `£${input.budgetGbp}`} · spend to date £${input.spendToDateGbp.toFixed(2)} · ticketing ${input.ticketingLinked ? input.ticketingProvider : "not linked"}`);
  if (proposal.notEnoughData) console.log(proposal.notEnoughData);
  const show = (kinds: string[]) => {
    for (const line of proposal.lines.filter((line) => kinds.includes(line.kind))) {
      console.log(`  ${label(line.kind)}  ${line.title}`);
      console.log(`      ${line.detail}`);
      console.log(`      ${line.writeText}${line.blockedReason ? `\n      ${line.blockedReason}` : ""}`);
    }
  };
  console.log(`\nCreatives`);
  show(["add_creative", "claim_ready", "pause_creative"]);
  if (proposal.notes.pauses) console.log(`  ${proposal.notes.pauses}`);
  for (const watch of proposal.watch.creatives) console.log(`  Watch: ${watch.title} · ${watch.detail}`);
  console.log(`\nAudiences`);
  show(["bring_back_audience", "missing_default", "drop_audience", "move_budget"]);
  if (proposal.notes.drops) console.log(`  ${proposal.notes.drops}`);
  for (const watch of proposal.watch.audiences) console.log(`  Watch: ${watch.title} · ${watch.detail}`);
  console.log(`\nShadow: nothing here can be applied yet. Apply accepted (0)`);
  console.log(`\nSupply read: ${input.supply.length} file${input.supply.length === 1 ? "" : "s"} in the ${weekLabel(plan.cycleMonday)} folders${input.supply.length ? `: ${input.supply.map((file) => `${file.path} / ${file.name}${file.alreadyInCampaign ? " (in campaign)" : ""}`).join("; ")}` : ""}`);
  console.log(`Claims read: ${input.claims.length} approved · stopped ad sets: ${input.adSets.filter((set) => !set.delivering).length} · delivering: ${input.adSets.filter((set) => set.delivering).length} · creatives: ${new Set(input.ads.map((ad) => ad.name)).size}`);
}

function label(kind: string): string {
  return { add_creative: "Add       ", claim_ready: "Claim     ", pause_creative: "Pause     ", bring_back_audience: "Bring back", missing_default: "Default   ", drop_audience: "Drop      ", move_budget: "Move      " }[kind] ?? kind;
}

/** HE1: the read-only purchase table. One row per on-sale event, plus any --also show. Nothing is written anywhere. */
async function printPurchaseTable(): Promise<void> {
  const day = shadowDay ?? todayLondon(new Date());
  console.log(`# Per-event purchases (HE1, HT1) — read only · ${shadowDay ? `shadow run for ${day}` : `run for ${day}`}\n`);
  let events: EventRow[] = await loadOnSaleEvents(db, day);
  if (eventCodes.length) {
    const wanted = new Set(eventCodes.map((code) => code.toLowerCase()));
    events = events.filter((event) => wanted.has((event.event_code ?? "").toLowerCase()));
  }
  const onSale = new Set(events.map((event) => event.id));
  if (alsoCodes.length) {
    const extra = await db.from("events").select("id, name, event_code, event_date, general_sale_at, presale_at, status, client_id, budget_marketing, drive_folder_id, signup_url, ticket_url").in("event_code", alsoCodes);
    if (extra.error) throw new Error(`events --also: ${extra.error.message}`);
    for (const row of (extra.data ?? []) as EventRow[]) if (!onSale.has(row.id)) events.push(row);
  }
  const raw = await loadInsights(db);
  const result = await loadPurchaseReads({
    db,
    events: events.map((event) => ({ id: event.id, event_code: event.event_code, client_id: event.client_id, event_date: event.event_date, signup_url: event.signup_url ?? null, ticket_url: event.ticket_url ?? null, presale_at: event.presale_at ?? null, general_sale_at: event.general_sale_at })),
    raw,
    day,
    shadow: Boolean(shadowDay),
    config: ONSALE_PHASE,
    graph,
    graphReason: token ? undefined : "META_ACCESS_TOKEN is not set",
    everyPixel: true,
  });
  const cell = (value: string) => value.replace(/\|/g, "\\|");
  const rows = events
    .map((event) => ({ event, read: result.reads.get(event.id)! }))
    .sort((a, b) => (a.event.event_code ?? "").localeCompare(b.event.event_code ?? ""));
  console.log(`| event | resolved pixel (share of spend) | stored pixel · match | own domain, or why not | on the domain 14d / 28d | ticket platform · its share of the pixel's purchases, 28d | attributed on the pixel, counted from | since on sale: total (per campaign) | attributed 14d, any show | state |`);
  console.log(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const { event, read } of rows) {
    const pixel = read.pixel ? `${read.pixel.id}${read.pixelName ? ` (${read.pixelName})` : ""} · ${Math.round(read.pixel.spendShare * 100)} %${read.otherPixels.map((other) => ` · also ${other.id} ${Math.round(other.spendShare * 100)} %`).join("")}` : read.state === "not_read" ? "not read" : "none on its ad sets";
    const stored = read.pixel ? `${read.pixel.stored ?? "none stored"} · ${read.pixel.matches ? "match" : read.pixel.stored ? "MISMATCH" : "nothing to match"}` : "—";
    const onDomain = read.onDomain ? `${read.onDomain.d14} / ${read.onDomain.d28}` : "—";
    const share = read.platformShare;
    const platform = !read.platform
      ? "not on a platform"
      : share
        ? `${read.platform} · ${share.share == null ? "no purchases on the pixel" : `${Math.round(share.share * 100)} % (${share.purchases} of ${share.pixelPurchases})`}${share.elsewhereHost ? ` · rest mostly ${share.elsewhereHost}` : ""}`
        : read.pixelWide
          ? `${read.platform} · not on the platform path${read.pixelWide.topHost ? ` (pixel's top host ${read.pixelWide.topHost}, ${read.pixelWide.d28} in 28d)` : ""}`
          : `${read.platform} · no pixel to read a share on`;
    const credited = read.attributedOnPixel;
    const trigger = credited ? `${credited.count} · from ${dayMonth(credited.fromDay)}${credited.sinceOnSale ? " (on sale under 14 days)" : " (14 days)"}` : "—";
    const total = credited ? `${credited.total.purchases} since ${dayMonth(credited.total.fromDay)} · £${credited.total.spend.toFixed(2)}${credited.total.byCampaign.length ? ` (${credited.total.byCampaign.map((row) => `${row.campaign}: ${row.purchases} · £${row.spend.toFixed(2)}`).join("; ")})` : ""}` : "—";
    console.log(`| ${cell(event.event_code ?? event.name)}${onSale.has(event.id) ? "" : " (not on sale now)"} | ${cell(pixel)} | ${cell(stored)} | ${cell(domainCell(read))} | ${onDomain} | ${cell(platform)} | ${cell(trigger)} | ${cell(total)} | ${read.attributedPurchases.count} | ${cell(stateLabel(read.state))} |`);
  }
  console.log(`\nEvents ${events.length} · Meta calls ${result.metaCalls} (reads only) · CIRQLIN page reads ${result.cirqlinReads} · writes 0`);
  console.log(`The domain breakdown reaches back ${ONSALE_PHASE.purchaseHistoryDays} days: Meta returns no more, so there is no 90-day figure.`);
  for (const note of result.notes) console.log(`note: ${note}`);
  console.log(`\n## The purchase line each would show\n`);
  for (const { event, read } of rows) {
    const why = purchaseWhy(read, false, ONSALE_PHASE);
    console.log(`${event.event_code ?? event.name}`);
    for (const line of why.pixel) console.log(`  [setup] ${line}`);
    console.log(`  ${why.purchase}${why.attributed ? `\n  ${why.attributed}` : ""} ${why.moves}${why.context ? `\n  ${why.context}` : ""}`);
    console.log(`  393: ${why.pixelNarrow.map((line) => `[setup] ${line} · `).join("")}${why.purchaseNarrow}${why.attributedNarrow ? ` ${why.attributedNarrow}` : ""}${why.contextNarrow ? ` ${why.contextNarrow}` : ""}`);
  }
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ day, metaCalls: result.metaCalls, cirqlinReads: result.cirqlinReads, notes: result.notes, rows: rows.map(({ event, read }) => ({ eventCode: event.event_code, onSale: onSale.has(event.id), read })) }, null, 2));
    console.log(`\nwrote ${jsonOut}`);
  }
}

function stateLabel(state: PurchaseRead["state"]): string {
  return {
    not_read: "not read",
    no_pixel: "no pixel",
    no_url: "no page or ticket URL",
    no_own_domain: "no domain of its own",
    shared_domain: "shared domain",
    nothing_reaches: "nothing reaches",
    under_bar: "under the bar",
    proposed: "proposed (own domain)",
    no_ticket_url: "no ticket URL stored",
    platform_no_purchases: "platform: no purchases on the pixel",
    pixel_sells_elsewhere: "platform: pixel sells elsewhere",
    platform_under_bar: "platform: under the bar",
    platform_proposed: "platform: proposed",
  }[state];
}

function domainCell(read: PurchaseRead): string {
  switch (read.domainKind) {
    case "own":
      return `${read.domain} · own${read.domainVia === "cirqlin_custom_domain" ? " (CIRQLIN custom domain behind its crqln.com link)" : ""}${read.ticketSite ? ` · tickets ${read.ticketSite}` : ""}`;
    case "shared_domain":
      return `${read.domain} · shared with ${read.sharedWith} other show${read.sharedWith === 1 ? "" : "s"}`;
    case "no_own_domain":
      return `no domain of its own${read.cirqlinPage ? " (crqln.com page, no custom domain)" : ""}${read.ticketSite ? ` · tickets ${read.ticketSite}` : ""}`;
    case "ticket_site_only":
      return `no page; tickets ${read.ticketSite ?? "—"}`;
    case "no_url":
      return "no page or ticket URL";
    default:
      return `not read: ${read.notRead ?? "—"}`;
  }
}
