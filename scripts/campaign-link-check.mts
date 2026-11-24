/**
 * R5 — the nightly campaign link check, by hand (brief R5). The cron comes
 * later, once design rules on the alert words.
 *
 *   npx tsx --env-file=.env.local scripts/campaign-link-check.mts --dry-run
 *   npx tsx --env-file=.env.local scripts/campaign-link-check.mts --dry-run --days 7 --all
 *
 * Reads prod with the service role, SELECTs only, paged past the 1,000-row
 * cap: `ad_daily_insights` (campaigns that spent in the last --days, default
 * 7), `launched_ad_sets` (the event each ad set is linked to) and `events`.
 * For each campaign it prints the name's [CODE], the linked event, the venue
 * of its ad account and the venue's account, and flags where they disagree
 * (--all prints the agreeing ones too). Then every Meta campaign id that two
 * events claim in `events.meta_campaign_id`. Zero Meta calls, no Slack, no
 * write.
 */

import { createClient } from "@supabase/supabase-js";

import {
  checkCampaignLinks,
  duplicateCampaignClaims,
  type LinkCheckCampaign,
  type LinkCheckEvent,
} from "../lib/launch-guard/link-check.ts";
import { eventPixelOverrideRows, venueMapRows } from "../lib/launch-guard/venue-defaults.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const days = Number(value("--days") ?? 7);
if (!flag("--dry-run") || !Number.isInteger(days) || days < 1) {
  console.error("usage: scripts/campaign-link-check.mts --dry-run [--days 7] [--all]");
  process.exit(2);
}
const showAll = flag("--all");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const PAGE = 1000;

async function pageAll<T>(label: string, build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

type InsightRow = { id: string; meta_campaign_id: string | null; campaign_name: string | null; ad_account_id: string | null; meta_adset_id: string | null; spend: number | string | null };
const insights = await pageAll<InsightRow>("ad_daily_insights", (from, to) =>
  db
    .from("ad_daily_insights")
    .select("id, meta_campaign_id, campaign_name, ad_account_id, meta_adset_id, spend")
    .gte("date", since)
    .gt("spend", 0)
    .order("id")
    .range(from, to),
);

const byCampaign = new Map<string, LinkCheckCampaign & { adSets: Set<string> }>();
for (const row of insights) {
  if (!row.meta_campaign_id) continue;
  const campaign = byCampaign.get(row.meta_campaign_id) ?? {
    campaignId: row.meta_campaign_id,
    campaignName: row.campaign_name,
    adAccountId: row.ad_account_id,
    spend: 0,
    adSetIds: [],
    adSets: new Set<string>(),
  };
  campaign.spend += Number(row.spend ?? 0);
  if (row.meta_adset_id) campaign.adSets.add(row.meta_adset_id);
  if (row.campaign_name) campaign.campaignName = row.campaign_name;
  byCampaign.set(row.meta_campaign_id, campaign);
}
const campaigns: LinkCheckCampaign[] = [...byCampaign.values()].map(({ adSets, ...rest }) => ({ ...rest, adSetIds: [...adSets] }));

const adSetIds = [...new Set(campaigns.flatMap((c) => c.adSetIds))];
const adSetEvent = new Map<string, string>();
for (let i = 0; i < adSetIds.length; i += 200) {
  const chunk = adSetIds.slice(i, i + 200);
  const rows = await pageAll<{ id: string; meta_adset_id: string; event_id: string | null }>("launched_ad_sets", (from, to) =>
    db.from("launched_ad_sets").select("id, meta_adset_id, event_id").in("meta_adset_id", chunk).order("id").range(from, to),
  );
  for (const row of rows) if (row.event_id) adSetEvent.set(row.meta_adset_id, row.event_id);
}

type EventRow = { id: string; event_code: string | null; client_id: string | null; venue_key: string | null; venue_name: string | null; meta_ad_account_id: string | null; meta_campaign_id: string | null };
const eventRows = await pageAll<EventRow>("events", (from, to) =>
  db.from("events").select("id, event_code, client_id, venue_key, venue_name, meta_ad_account_id, meta_campaign_id").order("id").range(from, to),
);
const events: LinkCheckEvent[] = eventRows.map((row) => ({
  id: row.id,
  code: row.event_code,
  clientId: row.client_id,
  venueKey: row.venue_key,
  venueName: row.venue_name,
  metaAdAccountId: row.meta_ad_account_id,
  metaCampaignId: row.meta_campaign_id,
}));

const rows = checkCampaignLinks({ campaigns, events, adSetEvent }).sort((a, b) => b.problems.length - a.problems.length || b.spend - a.spend);
const flagged = rows.filter((row) => row.problems.length > 0);
const duplicates = duplicateCampaignClaims(events);

const cell = (value: string | null | undefined) => (value ?? "—").replace(/\|/g, "\\|");
console.log(`# Campaign link check · DRY RUN — nothing written, no Meta call, no Slack`);
console.log(`window: spend > 0 since ${since} (${days} days) · ${insights.length} insight rows · ${campaigns.length} campaigns · ${adSetEvent.size} of ${adSetIds.length} ad sets linked to an event · ${events.length} events`);
console.log("");
console.log(`## Venue map (lib/launch-guard/venue-defaults.ts, replaced by venue card R2)`);
console.log("| client | venue | ad account | pixel |");
console.log("|---|---|---|---|");
for (const venue of venueMapRows()) {
  console.log(`| ${venue.clientId.slice(0, 8)} | ${venue.name} | ${venue.adAccountId ? `act_${venue.adAccountId} ${venue.adAccountName}` : "not set"} | ${venue.pixelId ? `${venue.pixelId} ${venue.pixelName}` : "not set"} |`);
}
for (const override of eventPixelOverrideRows()) {
  const code = events.find((event) => event.id === override.eventId)?.code ?? override.eventId;
  console.log(`| ${override.clientId.slice(0, 8)} | event override ${code} | — | ${override.pixelId} |`);
}
console.log("");
console.log(`## Campaigns that spent: ${flagged.length} of ${rows.length} disagree`);
console.log("| campaign | name | account | spend | name code | linked event (via) | account's venue | event's venue | event's account | problems |");
console.log("|---|---|---|---:|---|---|---|---|---|---|");
for (const row of showAll ? rows : flagged) {
  console.log(
    `| ${row.campaignId} | ${cell(row.campaignName)} | ${cell(row.adAccountId)} | £${row.spend.toFixed(2)} | ${cell(row.nameCode)} | ${row.linkedEvents.length ? `${row.linkedEvents.join(", ")} (${row.linkedVia})` : "—"} | ${cell(row.accountVenue)} | ${cell(row.eventVenue)} | ${row.rightAccount ? `act_${row.rightAccount}` : "—"} | ${row.problems.join(", ") || "ok"} |`,
  );
}
const counts = new Map<string, number>();
for (const row of flagged) for (const problem of row.problems) counts.set(problem, (counts.get(problem) ?? 0) + 1);
console.log("");
console.log(`by problem: ${[...counts.entries()].map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}`);
console.log("");
console.log(`## Meta campaign ids claimed by two shows (events.meta_campaign_id, different codes): ${duplicates.claims.length}`);
if (duplicates.claims.length) {
  console.log("| campaign id | event codes | event rows |");
  console.log("|---|---|---:|");
  for (const dup of duplicates.claims) console.log(`| ${dup.campaignId} | ${dup.eventCodes.join(", ")} | ${dup.events} |`);
}
console.log(`(${duplicates.sameCode} more ids are claimed by several event rows that share one code — a multi-fixture show — and are not flagged)`);
