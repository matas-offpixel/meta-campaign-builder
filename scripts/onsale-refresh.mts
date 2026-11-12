/**
 * The on-sale refresh by hand. Dry run by default: reads prod (service
 * role, SELECTs; one Drive listing per cycle type folder), builds every
 * proposal and prints it. Nothing is written — not proposals, not Slack,
 * never Meta.
 *
 *   npx tsx --env-file=.env.local scripts/onsale-refresh.mts --event P26-BDAY --shadow 2026-11-12
 *   npx tsx --env-file=.env.local scripts/onsale-refresh.mts --shadow 2026-11-12          # every on-sale event
 *   npx tsx --env-file=.env.local scripts/onsale-refresh.mts --event P26-BDAY --shadow 2026-11-12 --apply
 *
 * --shadow DAY reads the data to the day before (R1's shadow catch-up);
 * without it the run is for today. --apply stores the shadow proposals
 * (and posts to Slack only when notify()'s own gates are open); P1 never
 * applies a line. --json FILE writes the result.
 */

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { notify } from "../lib/notify/slack.ts";
import { buildLiveNotifyDeps } from "../lib/notify/slack-deps.ts";
import { runOnsaleRefresh, type ProposalRecord } from "../lib/onsale-refresh/runner.ts";
import { shortDay, weekLabel } from "../lib/onsale-refresh/schedule.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const values = (name: string) => argv.flatMap((arg, index) => (arg === name && argv[index + 1] ? [argv[index + 1]!] : []));
const apply = flag("--apply");
const shadowDay = values("--shadow")[0];
const eventCodes = values("--event");
const jsonOut = values("--json")[0] ?? null;
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

console.log(`# On-sale refresh ${apply ? "APPLY (shadow proposals stored)" : "DRY RUN — nothing written"}${shadowDay ? ` · shadow run for ${shadowDay}` : ""}\n`);
const result = await runOnsaleRefresh({
  env: { ...process.env, ENABLE_ONSALE_REFRESH: "1" },
  db,
  dryRun: !apply,
  shadowDay,
  eventCodes: eventCodes.length ? eventCodes : undefined,
  notify: apply ? (opts) => notify(opts, buildLiveNotifyDeps(db)) : undefined,
});
if ("skippedReason" in result) {
  console.log(result);
  process.exit(0);
}

console.log(`day ${result.day} · events ${result.events} · proposals ${result.proposals.length} · Drive calls ${result.driveCalls} · Meta calls 0`);
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
  console.log(`\nObjective\n${proposal.why.objective}\n${proposal.why.purchase} ${proposal.why.moves}`);
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
