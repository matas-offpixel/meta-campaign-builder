#!/usr/bin/env -S npx tsx
// Interest-cluster performance, registration phase. Read-only: Graph GETs,
// Supabase SELECTs, and the Cirqlin UTM CSV. Writes nothing to Meta.
//
//   npx tsx --env-file=.env.local scripts/interest-performance.mts \
//     [--since 2026-01-01] [--refresh] [--cirqlin-csv docs/analysis/cirqlin-signup-utms-2026-10-06.csv]
//
// Raw ad sets are cached at scripts/out/interest-insights/<account_id>/<adset_id>.json
// (custom audience lists replaced by their counts). Re-runs read the cache
// unless --refresh. Writes docs/analysis/interest-performance-<date>.{md,json}
// and docs/analysis/interest-templates-seed.json.
//
// Requires env: META_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  graphGetWithToken,
  getLastKnownMetaAppUsage,
  getLastKnownMetaBucUsage,
} from "../lib/meta/client.ts";
import { campaignMatchesBracketedEventCode } from "../lib/insights/meta-event-code-match.ts";
import {
  buildClusters,
  buildInterestStats,
  chooseAccountActionType,
  interestsOfTargeting,
  joinFirstParty,
  parseUtmCsv,
  phaseBucket,
  rankClusters,
  regActionsOf,
  registrationReason,
  renderInterestReport,
  seedFromReport,
  whatToTestNext,
  type AggregateContext,
  type AnalysisAdSet,
  type InterestReportJson,
  type LaunchedDescriptor,
  type RegActionType,
} from "../lib/analysis/interest-performance.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CACHE = path.join(ROOT, "scripts/out/interest-insights");
const OUT_DIR = path.join(ROOT, "docs/analysis");

const args = process.argv.slice(2);
function flag(name: string): string | null {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}
const SINCE = flag("since");
const REFRESH = args.includes("--refresh");
const TODAY = new Date().toISOString().slice(0, 10);
const CIRQLIN_CSV = flag("cirqlin-csv") ?? latestCirqlinCsv();

const TOKEN = process.env.META_ACCESS_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("Missing META_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local");
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const EXTRA_ACCOUNTS = [
  "1073273492854557",
  "606252931141334",
  "2011069725849568",
  "901661116878308",
  "1967530076312",
  "10151014958791885",
  "713771672906815",
  "759664074876110",
];

const ADSET_FIELDS = [
  "id",
  "name",
  "campaign_id",
  "campaign{name,objective}",
  "effective_status",
  "optimization_goal",
  "promoted_object",
  "targeting",
  "start_time",
  "end_time",
  "insights.date_preset(maximum){spend,impressions,reach,inline_link_clicks,actions,cost_per_action_type}",
].join(",");

const STATUSES = [
  "ACTIVE",
  "PAUSED",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "WITH_ISSUES",
  "ARCHIVED",
  "IN_PROCESS",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
];

function latestCirqlinCsv(): string | null {
  if (!existsSync(OUT_DIR)) return null;
  const files = readdirSync(OUT_DIR).filter((f) => /^cirqlin-signup-utms-\d{4}-\d{2}-\d{2}\.csv$/.test(f)).sort();
  return files.length ? path.join(OUT_DIR, files[files.length - 1]) : null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Pause when the account's BUC or the app budget runs hot. */
async function pace(actId: string) {
  const buc = getLastKnownMetaBucUsage()?.snapshot.buckets.filter((b) => b.adAccountId === actId) ?? [];
  const bucMax = Math.max(0, ...buc.map((b) => b.maxPercent));
  const eta = Math.max(0, ...buc.map((b) => b.estimatedTimeToRegainAccessMinutes ?? 0));
  const appMax = getLastKnownMetaAppUsage()?.snapshot.maxPercent ?? 0;
  if (bucMax >= 75 || appMax >= 75) {
    const wait = Math.min(Math.max(eta, 1) * 60_000, 5 * 60_000);
    console.log(`  usage high (${actId} BUC ${bucMax}%, app ${appMax}%) — waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  } else {
    await sleep(400);
  }
}

type RawAdSet = Record<string, unknown> & {
  id: string;
  targeting?: Record<string, unknown>;
};

function stripAudiences(raw: RawAdSet): RawAdSet {
  const targeting = { ...(raw.targeting ?? {}) } as Record<string, unknown>;
  const custom = Array.isArray(targeting.custom_audiences) ? targeting.custom_audiences.length : 0;
  const excluded = Array.isArray(targeting.excluded_custom_audiences) ? targeting.excluded_custom_audiences.length : 0;
  delete targeting.custom_audiences;
  delete targeting.excluded_custom_audiences;
  return { ...raw, targeting, _custom_audience_count: custom, _excluded_custom_audience_count: excluded };
}

interface AccountMeta {
  id: string;
  name: string | null;
  currency: string | null;
  read: boolean;
  error?: string;
}

async function pullAccount(accountId: string): Promise<{ meta: AccountMeta; adSets: RawAdSet[] }> {
  const actId = `act_${accountId}`;
  const dir = path.join(CACHE, accountId);
  const indexPath = path.join(dir, "_index.json");
  if (!REFRESH && existsSync(indexPath)) {
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as { meta: AccountMeta; adSetIds: string[] };
    const adSets = index.adSetIds.map((id) => JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf8")) as RawAdSet);
    console.log(`${actId}: ${adSets.length} ad sets from cache`);
    return { meta: index.meta, adSets };
  }
  let meta: AccountMeta;
  try {
    const info = await graphGetWithToken<{ name?: string; currency?: string }>(`/${actId}`, { fields: "name,currency" }, TOKEN!);
    meta = { id: accountId, name: info.name ?? null, currency: info.currency ?? null, read: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`${actId}: refused — ${message}`);
    return { meta: { id: accountId, name: null, currency: null, read: false, error: message }, adSets: [] };
  }
  const adSets: RawAdSet[] = [];
  let after: string | null = null;
  let limit = 200;
  for (;;) {
    await pace(actId);
    const params: Record<string, string> = {
      fields: ADSET_FIELDS,
      limit: String(limit),
      filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: STATUSES }]),
    };
    if (after) params.after = after;
    let page: { data?: RawAdSet[]; paging?: { cursors?: { after?: string }; next?: string } };
    try {
      page = await graphGetWithToken(`/${actId}/adsets`, params, TOKEN!);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/reduce the amount of data|code[^0-9]*1\b|too much data/i.test(message) && limit > 25) {
        limit = limit === 200 ? 50 : 25;
        console.log(`  ${actId}: page too large, retrying at limit=${limit}`);
        continue;
      }
      throw err;
    }
    for (const row of page.data ?? []) adSets.push(stripAudiences(row));
    after = page.paging?.next ? (page.paging.cursors?.after ?? null) : null;
    process.stdout.write(`\r${actId}: ${adSets.length} ad sets`);
    if (!after) break;
  }
  process.stdout.write("\n");
  mkdirSync(dir, { recursive: true });
  for (const a of adSets) writeFileSync(path.join(dir, `${a.id}.json`), `${JSON.stringify(a, null, 2)}\n`);
  writeFileSync(indexPath, `${JSON.stringify({ meta, pulledAt: new Date().toISOString(), adSetIds: adSets.map((a) => a.id) }, null, 2)}\n`);
  return { meta, adSets };
}

/** `isNull` columns must be null; `notNull` columns must not be. */
async function loadPaged<T>(
  table: string,
  columns: string,
  filters: { isNull?: string[]; notNull?: string[] } = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(columns);
    for (const col of filters.isNull ?? []) q = q.is(col, null);
    for (const col of filters.notNull ?? []) q = q.not(col, "is", null);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function fxRates(currencies: string[]): Promise<InterestReportJson["fx"]> {
  const fxPath = path.join(CACHE, "_fx.json");
  const need = currencies.filter((c) => c !== "GBP");
  if (existsSync(fxPath)) {
    const cached = JSON.parse(readFileSync(fxPath, "utf8")) as InterestReportJson["fx"];
    if (need.every((c) => cached.rates[c] != null)) return cached;
  }
  const rates: Record<string, number> = { GBP: 1 };
  let date = TODAY;
  if (need.length) {
    const res = await fetch(`https://api.frankfurter.app/latest?from=GBP&to=${need.join(",")}`);
    if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
    const body = (await res.json()) as { date: string; rates: Record<string, number> };
    date = body.date;
    for (const c of need) rates[c] = Math.round((1 / body.rates[c]) * 1e6) / 1e6;
  }
  const fx = { base: "GBP" as const, rates, source: "frankfurter.app (ECB reference)", date };
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(fxPath, `${JSON.stringify(fx, null, 2)}\n`);
  return fx;
}

async function resolveMissingNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const namesPath = path.join(CACHE, "_interest-names.json");
  const cached: Record<string, string> = existsSync(namesPath) ? JSON.parse(readFileSync(namesPath, "utf8")) : {};
  for (const [id, name] of Object.entries(cached)) out.set(id, name);
  const todo = ids.filter((id) => !out.has(id));
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const res = await graphGetWithToken<{ data?: { id: string; name: string }[] }>(
      "/search",
      { type: "adinterestvalid", interest_fbid_list: JSON.stringify(batch) },
      TOKEN!,
    );
    for (const row of res.data ?? []) out.set(String(row.id), row.name);
    await sleep(400);
  }
  writeFileSync(namesPath, `${JSON.stringify(Object.fromEntries(out), null, 2)}\n`);
  return out;
}

function isMetaSourced(utm: Record<string, unknown> | null): boolean {
  if (!utm) return false;
  if (typeof utm.fbclid === "string" && utm.fbclid.trim()) return true;
  return /^(meta|facebook|instagram|fb|ig)\b/i.test(String(utm.utm_source ?? ""));
}

async function main() {
  console.log(`interest-performance ${TODAY}${SINCE ? ` since ${SINCE}` : ""}${REFRESH ? " (refresh)" : ""}`);

  type LaunchedRow = {
    meta_adset_id: string;
    ad_account_id: string | null;
    event_id: string | null;
    client_id: string | null;
    source_type: string | null;
    source_id: string | null;
    source_name: string | null;
    interest_ids: unknown;
    phase_at_launch: string | null;
    launched_at: string | null;
    descriptor_source: string | null;
    draft_id: string | null;
  };
  const launched = await loadPaged<LaunchedRow>(
    "launched_ad_sets",
    "meta_adset_id, ad_account_id, event_id, client_id, source_type, source_id, source_name, interest_ids, phase_at_launch, launched_at, descriptor_source, draft_id",
  );
  const clients = await loadPaged<{ id: string; name: string; meta_ad_account_id: string | null }>(
    "clients",
    "id, name, meta_ad_account_id",
  );
  const launchedById = new Map(launched.map((r) => [String(r.meta_adset_id), r]));
  const launchedAccounts = new Set(
    launched.map((r) => String(r.ad_account_id ?? "").replace(/^act_/, "")).filter(Boolean),
  );
  const accountIds = [...new Set([...launchedAccounts, ...EXTRA_ACCOUNTS])].sort();
  const clientById = new Map(clients.map((c) => [c.id, c.name]));
  const clientByAccount = new Map<string, string>();
  for (const c of clients) {
    const acct = String(c.meta_ad_account_id ?? "").replace(/^act_/, "");
    if (acct && !clientByAccount.has(acct)) clientByAccount.set(acct, c.name);
  }

  const accounts: InterestReportJson["accounts"] = [];
  const raw: { accountId: string; meta: AccountMeta; adSet: RawAdSet }[] = [];
  for (const id of accountIds) {
    const { meta, adSets } = await pullAccount(id);
    accounts.push({ ...meta, adSets: adSets.length, notInLaunchedAdSets: !launchedAccounts.has(id) });
    for (const adSet of adSets) raw.push({ accountId: id, meta, adSet });
  }

  // Interest names: targeting, then drafts' interestGroups, then Meta search.
  const draftIds = [...new Set(launched.map((r) => r.draft_id).filter(Boolean))] as string[];
  const draftNames = new Map<string, string>();
  for (let i = 0; i < draftIds.length; i += 100) {
    const { data, error } = await supabase
      .from("campaign_drafts")
      .select("draft_json")
      .in("id", draftIds.slice(i, i + 100));
    if (error) throw new Error(`campaign_drafts: ${error.message}`);
    for (const row of data ?? []) {
      const groups = (row.draft_json as { audiences?: { interestGroups?: { interests?: { id?: string; name?: string }[] }[] } })
        ?.audiences?.interestGroups;
      for (const g of groups ?? []) for (const i2 of g.interests ?? []) {
        if (i2?.id && i2.name && !draftNames.has(String(i2.id))) draftNames.set(String(i2.id), i2.name);
      }
    }
  }

  const all: AnalysisAdSet[] = [];
  for (const { accountId, meta, adSet } of raw) {
    const campaign = (adSet.campaign ?? {}) as { name?: string; objective?: string };
    const promoted = (adSet.promoted_object ?? {}) as { custom_event_type?: string };
    const insights = ((adSet.insights as { data?: Record<string, unknown>[] } | undefined)?.data ?? [])[0];
    const { interests, acrossFlexGroups } = interestsOfTargeting(adSet.targeting);
    const targeting = (adSet.targeting ?? {}) as { targeting_automation?: { advantage_audience?: number } };
    const l = launchedById.get(adSet.id);
    const descriptor: LaunchedDescriptor | null = l
      ? {
          eventId: l.event_id,
          clientId: l.client_id,
          sourceType: l.source_type,
          sourceName: l.source_name,
          phaseAtLaunch: l.phase_at_launch,
          descriptorSource: l.descriptor_source,
          launchedAt: l.launched_at,
        }
      : null;
    all.push({
      id: adSet.id,
      name: String(adSet.name ?? ""),
      accountId,
      accountName: meta.name ?? accountId,
      currency: meta.currency ?? "GBP",
      campaignId: String(adSet.campaign_id ?? ""),
      campaignName: campaign.name ?? "",
      campaignObjective: campaign.objective ?? null,
      optimizationGoal: (adSet.optimization_goal as string) ?? null,
      customEventType: promoted.custom_event_type ?? null,
      effectiveStatus: (adSet.effective_status as string) ?? null,
      startTime: (adSet.start_time as string) ?? null,
      endTime: (adSet.end_time as string) ?? null,
      interests,
      interestsAcrossFlexGroups: acrossFlexGroups,
      customAudienceCount: Number(adSet._custom_audience_count ?? 0),
      excludedCustomAudienceCount: Number(adSet._excluded_custom_audience_count ?? 0),
      advantageAudience: targeting.targeting_automation?.advantage_audience === 1,
      spend: Number(insights?.spend ?? 0),
      impressions: Number(insights?.impressions ?? 0),
      reach: Number(insights?.reach ?? 0),
      linkClicks: Number(insights?.inline_link_clicks ?? 0),
      regActions: regActionsOf(insights?.actions),
      hasInsights: Boolean(insights),
      hasAnyActions: Array.isArray(insights?.actions) && (insights!.actions as unknown[]).length > 0,
      launched: descriptor,
      clientName:
        (l?.client_id && clientById.get(l.client_id)) || clientByAccount.get(accountId) || meta.name || accountId,
    });
  }

  const inWindow = all.filter((a) => !SINCE || (a.startTime ?? "") >= SINCE);
  const excludedByPhase: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  const registration: AnalysisAdSet[] = [];
  for (const a of inWindow) {
    const reason = registrationReason(a);
    if (reason) {
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      registration.push(a);
    } else {
      const bucket = phaseBucket(a);
      excludedByPhase[bucket] = (excludedByPhase[bucket] ?? 0) + 1;
    }
  }

  const missing = [...new Set(registration.flatMap((a) => a.interests.filter((i) => !i.name).map((i) => i.id)))];
  const fromDrafts = missing.filter((id) => draftNames.has(id));
  const searched = await resolveMissingNames(missing.filter((id) => !draftNames.has(id)));
  for (const a of registration) {
    a.interests = a.interests.map((i) => ({ id: i.id, name: i.name ?? draftNames.get(i.id) ?? searched.get(i.id) ?? null }));
  }
  console.log(`interest names: ${missing.length} missing in targeting, ${fromDrafts.length} from drafts, ${searched.size} via search`);

  const byAccount = new Map<string, AnalysisAdSet[]>();
  for (const a of registration) byAccount.set(a.accountId, [...(byAccount.get(a.accountId) ?? []), a]);
  const actionTypes = [...byAccount.entries()]
    .map(([id, list]) => chooseAccountActionType(id, list[0].accountName, list))
    .sort((a, b) => a.accountId.localeCompare(b.accountId));
  const chosenType: Record<string, RegActionType | null> = Object.fromEntries(actionTypes.map((f) => [f.accountId, f.chosen]));

  const fx = await fxRates([...new Set(registration.map((a) => a.currency))]);

  // First-party: Cirqlin CSV.
  const utmRows = CIRQLIN_CSV ? parseUtmCsv(readFileSync(CIRQLIN_CSV, "utf8")) : [];
  const fpJoin = joinFirstParty(registration, utmRows, { chosenType });
  const ctx: AggregateContext = { fx: fx.rates, chosenType, firstParty: fpJoin.adSets };

  // Event level: crm_base_tag → events.mailchimp_tag → [event_code] campaigns.
  const events = await loadPaged<{ id: string; event_code: string | null; mailchimp_tag: string | null }>(
    "events",
    "id, event_code, mailchimp_tag",
    { notNull: ["mailchimp_tag"] },
  );
  const tagToCode = new Map<string, string>();
  for (const e of events) if (e.mailchimp_tag && e.event_code) tagToCode.set(e.mailchimp_tag.trim().toLowerCase(), e.event_code);
  const eventRows = new Map<string, InterestReportJson["firstParty"]["events"][number]>();
  for (const r of utmRows) {
    const tag = (r.crm_base_tag ?? "").trim();
    const code = tagToCode.get(tag.toLowerCase());
    if (!code) continue;
    const row = eventRows.get(code) ?? {
      eventCode: code,
      crmBaseTag: tag,
      metaSourcedSignups: 0,
      allSignups: 0,
      paidTaggedSignups: 0,
      pixelRegistrations: 0,
      campaigns: 0,
    };
    row.allSignups += r.count;
    if (r.meta_sourced) row.metaSourcedSignups += r.count;
    if (r.utm_campaign) row.paidTaggedSignups += r.count;
    eventRows.set(code, row);
  }
  for (const row of eventRows.values()) {
    const camps = new Set<string>();
    for (const a of registration) {
      if (!campaignMatchesBracketedEventCode(a.campaignName, row.eventCode)) continue;
      camps.add(a.campaignId);
      const t = chosenType[a.accountId];
      row.pixelRegistrations += t ? (a.regActions[t] ?? 0) : 0;
    }
    row.campaigns = camps.size;
  }

  // This repo's event_signups — counts only.
  const signups = await loadPaged<{ event_id: string; utm: Record<string, unknown> | null }>(
    "event_signups",
    "event_id, utm",
    { isNull: ["deleted_at", "deduplicated_signup_id"] },
  );
  const local = new Map<string, { total: number; metaSourced: number; c: Set<string>; t: Set<string> }>();
  for (const s of signups) {
    const row = local.get(s.event_id) ?? { total: 0, metaSourced: 0, c: new Set(), t: new Set() };
    row.total += 1;
    if (isMetaSourced(s.utm)) row.metaSourced += 1;
    if (s.utm?.utm_campaign) row.c.add(String(s.utm.utm_campaign));
    if (s.utm?.utm_content) row.t.add(String(s.utm.utm_content));
    local.set(s.event_id, row);
  }

  const clustered = registration.filter((a) => a.interests.length > 0);
  const clusters = buildClusters(clustered, ctx);
  const ranked = rankClusters(clusters.filter((c) => !c.thin)).concat(rankClusters(clusters.filter((c) => c.thin)));
  const clientsSeen = [...new Set(clustered.map((a) => a.clientName))].sort();
  const perClient = clientsSeen.map((client) => {
    const cs = buildClusters(clustered.filter((a) => a.clientName === client), ctx);
    const r = rankClusters(cs.filter((c) => !c.thin)).concat(rankClusters(cs.filter((c) => c.thin)));
    return { client, ranked: r.map((c) => c.key), clusters: cs, nonThin: cs.filter((c) => !c.thin).length };
  });
  const interests = buildInterestStats(clustered, ctx);
  const rankedInterests = rankClusters(
    interests.map((i) => ({ ...i, key: i.id })).filter((i) => !i.thin),
  ).concat(rankClusters(interests.map((i) => ({ ...i, key: i.id })).filter((i) => i.thin)));
  const testNext = whatToTestNext(clustered, ranked, rankedInterests, ctx);

  const json: InterestReportJson = {
    generatedAt: new Date().toISOString(),
    since: SINCE,
    fx,
    accounts,
    totals: {
      adSets: inWindow.length,
      registrationAdSets: registration.length,
      registrationWithInterests: clustered.length,
      registrationWithoutInterests: registration.length - clustered.length,
      excludedByPhase,
      reasons,
      appLaunched: registration.filter((a) => a.launched).length,
      manual: registration.filter((a) => !a.launched).length,
      backfill: registration.filter((a) => a.launched?.descriptorSource === "backfill_from_launch_summary").length,
    },
    actionTypes,
    clusters,
    ranked: ranked.map((c) => c.key),
    perClient,
    interests,
    rankedInterests: rankedInterests.map((i) => i.id),
    noActions: registration
      .filter((a) => a.spend > 0 && !a.hasAnyActions)
      .map((a) => ({
        id: a.id,
        name: a.name,
        accountId: a.accountId,
        campaignName: a.campaignName,
        spend: a.spend,
        currency: a.currency,
        hasInsights: a.hasInsights,
      })),
    firstParty: {
      source: CIRQLIN_CSV ? path.relative(ROOT, CIRQLIN_CSV) : "no Cirqlin CSV",
      campaigns: fpJoin.campaigns,
      unmatchedPaidRows: fpJoin.unmatchedPaidRows,
      unmatchedPaidSignups: fpJoin.unmatchedPaidSignups,
      events: [...eventRows.values()].sort((a, b) => b.allSignups - a.allSignups),
      localEventSignups: [...local.entries()].map(([eventId, r]) => ({
        eventId,
        total: r.total,
        metaSourced: r.metaSourced,
        utmCampaigns: [...r.c].sort(),
        utmContents: [...r.t].sort(),
      })),
    },
    testNext,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const base = path.join(OUT_DIR, `interest-performance-${TODAY}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(json, null, 2)}\n`);
  writeFileSync(`${base}.md`, renderInterestReport(json));
  writeFileSync(path.join(OUT_DIR, "interest-templates-seed.json"), `${JSON.stringify(seedFromReport(json), null, 2)}\n`);
  console.log(
    `wrote ${path.relative(ROOT, base)}.{md,json}: ${registration.length} registration ad sets, ${clusters.length} clusters (${clusters.filter((c) => !c.thin).length} non-thin)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
