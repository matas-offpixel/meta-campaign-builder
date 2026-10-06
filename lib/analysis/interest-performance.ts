/**
 * Interest-cluster performance for the registration phase.
 *
 * Pure: no Meta, Supabase, or file access. scripts/interest-performance.mts
 * pulls the inputs and writes the JSON; `renderInterestReport` builds the
 * markdown from that JSON alone, so every figure in the report can be
 * recomputed from it.
 */

import { mapMetaObjectiveToInternal } from "../meta/campaign.ts";

export const REG_ACTION_TYPES = [
  "complete_registration",
  "offsite_conversion.fb_pixel_complete_registration",
  "lead",
] as const;
export type RegActionType = (typeof REG_ACTION_TYPES)[number];

export const THIN_MIN_AD_SETS = 3;
export const THIN_MIN_SPEND_GBP = 150;
/** Share of a cluster's spend that must sit in UTM-measured ad sets before its first-party CPR ranks. */
export const FIRST_PARTY_MIN_COVERAGE = 0.8;
/**
 * A campaign's ad sets are credited with UTM-matched signups only when
 * first-party ÷ pixel falls in this range. Outside it the UTM text was
 * usually static and copied from a duplicated campaign, so utm_content
 * names ad sets that did not drive the clicks.
 */
export const FIRST_PARTY_RATIO_RANGE: readonly [number, number] = [0.67, 1.5];

export interface InterestRef {
  id: string;
  name: string | null;
}

export interface LaunchedDescriptor {
  eventId: string | null;
  clientId: string | null;
  sourceType: string | null;
  sourceName: string | null;
  phaseAtLaunch: string | null;
  descriptorSource: string | null;
  launchedAt: string | null;
}

/** One ad set as the analysis sees it. Built by the script from the Graph cache. */
export interface AnalysisAdSet {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  currency: string;
  campaignId: string;
  campaignName: string;
  campaignObjective: string | null;
  optimizationGoal: string | null;
  customEventType: string | null;
  effectiveStatus: string | null;
  startTime: string | null;
  endTime: string | null;
  interests: InterestRef[];
  /** More than one flexible_spec entry carrying interests (AND across groups). */
  interestsAcrossFlexGroups: boolean;
  customAudienceCount: number;
  excludedCustomAudienceCount: number;
  advantageAudience: boolean;
  spend: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  /** action_type → count, only the registration candidates. */
  regActions: Partial<Record<RegActionType, number>>;
  hasInsights: boolean;
  hasAnyActions: boolean;
  launched: LaunchedDescriptor | null;
  clientName: string;
}

export type PhaseBucket = "registration" | "purchase" | "traffic" | "awareness" | "engagement" | "other";

/** Why an ad set counts as registration phase, or null when it does not. */
export function registrationReason(adSet: {
  customEventType: string | null;
  optimizationGoal: string | null;
  campaignObjective: string | null;
  launched: { phaseAtLaunch: string | null } | null;
}): string | null {
  if ((adSet.customEventType ?? "").toUpperCase() === "COMPLETE_REGISTRATION") return "promoted_object";
  if ((adSet.optimizationGoal ?? "").toUpperCase() === "LEAD_GENERATION") return "optimization_goal";
  const phase = (adSet.launched?.phaseAtLaunch ?? "").toLowerCase();
  if (phase === "signup" || phase === "registration") return "phase_at_launch";
  if (mapMetaObjectiveToInternal(adSet.campaignObjective, adSet.customEventType) === "registration") {
    return "campaign_objective";
  }
  return null;
}

export function phaseBucket(adSet: Parameters<typeof registrationReason>[0]): PhaseBucket {
  if (registrationReason(adSet)) return "registration";
  const mapped = mapMetaObjectiveToInternal(adSet.campaignObjective, adSet.customEventType);
  if (mapped === "purchase" || mapped === "initiate_checkout") return "purchase";
  if (mapped === "traffic") return "traffic";
  if (mapped === "awareness") return "awareness";
  if (mapped === "engagement") return "engagement";
  return "other";
}

/** Interests from targeting.interests and every flexible_spec entry, deduped by id, sorted by id. */
export function interestsOfTargeting(targeting: unknown): {
  interests: InterestRef[];
  acrossFlexGroups: boolean;
} {
  const byId = new Map<string, string | null>();
  const t = (targeting ?? {}) as {
    interests?: { id?: unknown; name?: unknown }[];
    flexible_spec?: { interests?: { id?: unknown; name?: unknown }[] }[];
  };
  const take = (list: { id?: unknown; name?: unknown }[] | undefined) => {
    for (const row of list ?? []) {
      const id = row?.id == null ? "" : String(row.id).trim();
      if (!id) continue;
      const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
      if (!byId.has(id) || (byId.get(id) == null && name)) byId.set(id, name);
    }
  };
  take(t.interests);
  let flexGroupsWithInterests = 0;
  for (const spec of t.flexible_spec ?? []) {
    if ((spec?.interests ?? []).length > 0) flexGroupsWithInterests += 1;
    take(spec?.interests);
  }
  const interests = [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { interests, acrossFlexGroups: flexGroupsWithInterests > 1 };
}

export function clusterKey(ids: readonly string[]): string {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).join(",");
}

/** Registration candidates present on an insights `actions` list. */
export function regActionsOf(actions: unknown): Partial<Record<RegActionType, number>> {
  const out: Partial<Record<RegActionType, number>> = {};
  for (const row of (Array.isArray(actions) ? actions : []) as { action_type?: string; value?: unknown }[]) {
    const type = row?.action_type as RegActionType | undefined;
    if (!type || !(REG_ACTION_TYPES as readonly string[]).includes(type)) continue;
    const value = Number(row.value);
    if (Number.isFinite(value)) out[type] = value;
  }
  return out;
}

export interface AccountActionFinding {
  accountId: string;
  accountName: string;
  registrationAdSets: number;
  populated: Record<RegActionType, { adSets: number; total: number }>;
  chosen: RegActionType | null;
  rule: string;
  /** Ad sets with zero of the chosen type but a non-zero other candidate. */
  otherTypeOnly: number;
}

const CHOICE_ORDER: RegActionType[] = [
  "complete_registration",
  "offsite_conversion.fb_pixel_complete_registration",
  "lead",
];

/**
 * One registration action type per account: the candidate with the largest
 * total across registration ad sets; ties go complete_registration, then the
 * pixel type, then lead. The others are reported, never summed.
 */
export function chooseAccountActionType(
  accountId: string,
  accountName: string,
  adSets: readonly AnalysisAdSet[],
): AccountActionFinding {
  const populated = Object.fromEntries(
    REG_ACTION_TYPES.map((type) => [type, { adSets: 0, total: 0 }]),
  ) as Record<RegActionType, { adSets: number; total: number }>;
  for (const adSet of adSets) {
    for (const type of REG_ACTION_TYPES) {
      const value = adSet.regActions[type] ?? 0;
      if (value > 0) {
        populated[type].adSets += 1;
        populated[type].total += value;
      }
    }
  }
  let chosen: RegActionType | null = null;
  for (const type of CHOICE_ORDER) {
    if (populated[type].adSets === 0) continue;
    if (!chosen || populated[type].total > populated[chosen].total) chosen = type;
  }
  const otherTypeOnly = chosen
    ? adSets.filter(
        (a) => !(a.regActions[chosen!] ?? 0) && REG_ACTION_TYPES.some((t) => t !== chosen && (a.regActions[t] ?? 0) > 0),
      ).length
    : 0;
  return {
    accountId,
    accountName,
    registrationAdSets: adSets.length,
    populated,
    chosen,
    rule: "largest total across registration ad sets; tie → complete_registration, pixel, lead",
    otherTypeOnly,
  };
}

export interface FirstPartyAdSet {
  /** UTM-matched first-party signups for this ad set. */
  signups: number;
}

export interface ClusterStats {
  key: string;
  interestIds: string[];
  interests: InterestRef[];
  name: string;
  groupNames: Record<string, number>;
  adSets: number;
  campaigns: number;
  clients: string[];
  accounts: string[];
  spendGbp: number;
  spendByCurrency: Record<string, number>;
  registrations: number;
  cprPixelGbp: number | null;
  regsPer100Gbp: number;
  reachSum: number;
  impressions: number;
  linkClicks: number;
  ctr: number | null;
  firstStart: string | null;
  lastEnd: string | null;
  appLaunched: number;
  manual: number;
  backfill: number;
  withCustomAudiences: number;
  advantageAudience: number;
  /** Ad sets reporting a registration type other than the account's chosen one, and none of the chosen. */
  otherTypeOnly: number;
  fpMeasuredSpendGbp: number;
  fpSignups: number;
  fpCoverage: number;
  cprFirstPartyGbp: number | null;
  cpr: number | null;
  cprSource: "first_party" | "pixel";
  thin: boolean;
  adSetIds: string[];
}

export interface AggregateContext {
  /** GBP per one unit of the currency. */
  fx: Record<string, number>;
  chosenType: Record<string, RegActionType | null>;
  /** Ad set id → first-party signups; absent = not UTM-measured. */
  firstParty: Record<string, FirstPartyAdSet>;
}

export function registrationsOf(adSet: AnalysisAdSet, ctx: AggregateContext): number {
  const type = ctx.chosenType[adSet.accountId];
  return type ? (adSet.regActions[type] ?? 0) : 0;
}

export function spendGbpOf(adSet: AnalysisAdSet, ctx: AggregateContext): number {
  const rate = ctx.fx[adSet.currency];
  if (rate == null) throw new Error(`No GBP rate for ${adSet.currency}`);
  return adSet.spend * rate;
}

function round(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function groupNameOf(adSet: AnalysisAdSet): string {
  return (adSet.launched?.sourceType === "interest_group" && adSet.launched.sourceName?.trim()) || adSet.name;
}

function mostCommon(counts: Record<string, number>): string {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

export function summarise(key: string, adSets: readonly AnalysisAdSet[], ctx: AggregateContext): ClusterStats {
  const names = new Map<string, Record<string, number>>();
  const groupNames: Record<string, number> = {};
  const spendByCurrency: Record<string, number> = {};
  let spendGbp = 0;
  let registrations = 0;
  let reachSum = 0;
  let impressions = 0;
  let linkClicks = 0;
  let fpMeasuredSpendGbp = 0;
  let fpSignups = 0;
  let firstStart: string | null = null;
  let lastEnd: string | null = null;
  for (const a of adSets) {
    const gbp = spendGbpOf(a, ctx);
    spendGbp += gbp;
    spendByCurrency[a.currency] = (spendByCurrency[a.currency] ?? 0) + a.spend;
    registrations += registrationsOf(a, ctx);
    reachSum += a.reach;
    impressions += a.impressions;
    linkClicks += a.linkClicks;
    const fp = ctx.firstParty[a.id];
    if (fp) {
      fpMeasuredSpendGbp += gbp;
      fpSignups += fp.signups;
    }
    const g = groupNameOf(a);
    groupNames[g] = (groupNames[g] ?? 0) + 1;
    for (const i of a.interests) {
      const byName = names.get(i.id) ?? {};
      if (i.name) byName[i.name] = (byName[i.name] ?? 0) + 1;
      names.set(i.id, byName);
    }
    if (a.startTime && (!firstStart || a.startTime < firstStart)) firstStart = a.startTime;
    const end = a.endTime ?? a.startTime;
    if (end && (!lastEnd || end > lastEnd)) lastEnd = end;
  }
  const interestIds = key ? key.split(",") : [];
  const interests = interestIds.map((id) => {
    const counts = names.get(id) ?? {};
    return { id, name: Object.keys(counts).length ? mostCommon(counts) : null };
  });
  const cprPixelGbp = registrations > 0 ? spendGbp / registrations : null;
  const fpCoverage = spendGbp > 0 ? fpMeasuredSpendGbp / spendGbp : 0;
  const cprFirstPartyGbp =
    fpCoverage >= FIRST_PARTY_MIN_COVERAGE && fpSignups > 0 ? fpMeasuredSpendGbp / fpSignups : null;
  const thin = adSets.length < THIN_MIN_AD_SETS || spendGbp < THIN_MIN_SPEND_GBP;
  return {
    key,
    interestIds,
    interests,
    name: mostCommon(groupNames),
    groupNames,
    adSets: adSets.length,
    campaigns: new Set(adSets.map((a) => a.campaignId)).size,
    clients: [...new Set(adSets.map((a) => a.clientName))].sort(),
    accounts: [...new Set(adSets.map((a) => a.accountId))].sort(),
    spendGbp: round(spendGbp),
    spendByCurrency: Object.fromEntries(Object.entries(spendByCurrency).map(([c, v]) => [c, round(v)])),
    registrations,
    cprPixelGbp: cprPixelGbp == null ? null : round(cprPixelGbp),
    regsPer100Gbp: spendGbp > 0 ? round((registrations / spendGbp) * 100) : 0,
    reachSum,
    impressions,
    linkClicks,
    ctr: impressions > 0 ? round((linkClicks / impressions) * 100, 3) : null,
    firstStart,
    lastEnd,
    appLaunched: adSets.filter((a) => a.launched).length,
    manual: adSets.filter((a) => !a.launched).length,
    backfill: adSets.filter((a) => a.launched?.descriptorSource === "backfill_from_launch_summary").length,
    withCustomAudiences: adSets.filter((a) => a.customAudienceCount > 0).length,
    advantageAudience: adSets.filter((a) => a.advantageAudience).length,
    otherTypeOnly: adSets.filter((a) => {
      const chosen = ctx.chosenType[a.accountId];
      return !(chosen && (a.regActions[chosen] ?? 0) > 0) && REG_ACTION_TYPES.some((t) => t !== chosen && (a.regActions[t] ?? 0) > 0);
    }).length,
    fpMeasuredSpendGbp: round(fpMeasuredSpendGbp),
    fpSignups,
    fpCoverage: round(fpCoverage, 3),
    cprFirstPartyGbp: cprFirstPartyGbp == null ? null : round(cprFirstPartyGbp),
    cpr: cprFirstPartyGbp != null ? round(cprFirstPartyGbp) : cprPixelGbp == null ? null : round(cprPixelGbp),
    cprSource: cprFirstPartyGbp != null ? "first_party" : "pixel",
    thin,
    adSetIds: adSets.map((a) => a.id).sort(),
  };
}

export function buildClusters(adSets: readonly AnalysisAdSet[], ctx: AggregateContext): ClusterStats[] {
  const byKey = new Map<string, AnalysisAdSet[]>();
  for (const a of adSets) {
    if (a.interests.length === 0) continue;
    const key = clusterKey(a.interests.map((i) => i.id));
    const list = byKey.get(key) ?? [];
    list.push(a);
    byKey.set(key, list);
  }
  return [...byKey.entries()].map(([key, list]) => summarise(key, list, ctx));
}

/** Lowest CPR first; no registrations last; registrations per £100 breaks ties. */
export function rankClusters<T extends { cpr: number | null; regsPer100Gbp: number; spendGbp: number; key: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const ac = a.cpr ?? Number.POSITIVE_INFINITY;
    const bc = b.cpr ?? Number.POSITIVE_INFINITY;
    if (ac !== bc) return ac - bc;
    if (a.regsPer100Gbp !== b.regsPer100Gbp) return b.regsPer100Gbp - a.regsPer100Gbp;
    if (a.spendGbp !== b.spendGbp) return b.spendGbp - a.spendGbp;
    return a.key.localeCompare(b.key);
  });
}

export interface InterestStats {
  id: string;
  name: string | null;
  adSets: number;
  clusters: number;
  aloneAdSets: number;
  spendGbp: number;
  registrations: number;
  cpr: number | null;
  regsPer100Gbp: number;
  /** Ad set spend and registrations divided equally across that ad set's interests. An estimate. */
  equalShareSpendGbp: number;
  equalShareRegistrations: number;
  thin: boolean;
  clients: string[];
}

export function buildInterestStats(adSets: readonly AnalysisAdSet[], ctx: AggregateContext): InterestStats[] {
  const rows = new Map<
    string,
    {
      names: Record<string, number>;
      adSets: AnalysisAdSet[];
      clusters: Set<string>;
      alone: number;
      shareSpend: number;
      shareRegs: number;
    }
  >();
  for (const a of adSets) {
    const n = a.interests.length;
    if (n === 0) continue;
    const key = clusterKey(a.interests.map((i) => i.id));
    const gbp = spendGbpOf(a, ctx);
    const regs = registrationsOf(a, ctx);
    for (const i of a.interests) {
      const row = rows.get(i.id) ?? { names: {}, adSets: [], clusters: new Set(), alone: 0, shareSpend: 0, shareRegs: 0 };
      if (i.name) row.names[i.name] = (row.names[i.name] ?? 0) + 1;
      row.adSets.push(a);
      row.clusters.add(key);
      if (n === 1) row.alone += 1;
      row.shareSpend += gbp / n;
      row.shareRegs += regs / n;
      rows.set(i.id, row);
    }
  }
  return [...rows.entries()].map(([id, row]) => {
    const spendGbp = row.adSets.reduce((s, a) => s + spendGbpOf(a, ctx), 0);
    const registrations = row.adSets.reduce((s, a) => s + registrationsOf(a, ctx), 0);
    return {
      id,
      name: Object.keys(row.names).length ? mostCommon(row.names) : null,
      adSets: row.adSets.length,
      clusters: row.clusters.size,
      aloneAdSets: row.alone,
      spendGbp: round(spendGbp),
      registrations,
      cpr: registrations > 0 ? round(spendGbp / registrations) : null,
      regsPer100Gbp: spendGbp > 0 ? round((registrations / spendGbp) * 100) : 0,
      equalShareSpendGbp: round(row.shareSpend),
      equalShareRegistrations: round(row.shareRegs, 1),
      thin: row.adSets.length < THIN_MIN_AD_SETS || spendGbp < THIN_MIN_SPEND_GBP,
      clients: [...new Set(row.adSets.map((a) => a.clientName))].sort(),
    };
  });
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface TestPair {
  a: { id: string; name: string | null; cpr: number | null };
  b: { id: string; name: string | null; cpr: number | null };
  /** Clients that ran both interests, in separate ad sets. */
  sharedClients: string[];
}

export interface ClusterOnClient {
  clusterKey: string;
  clusterName: string;
  clusterCpr: number | null;
  cprSource: "first_party" | "pixel";
  client: string;
  sibling: { key: string; name: string; cprOnClient: number; adSetsOnClient: number; jaccard: number };
}

/**
 * Strong single interests never targeted in the same ad set, and strong
 * clusters never run for a client where a similar cluster (Jaccard ≥ 0.5)
 * registered at or below the median non-thin CPR.
 */
export function whatToTestNext(
  adSets: readonly AnalysisAdSet[],
  rankedClusters: readonly ClusterStats[],
  rankedInterests: readonly InterestStats[],
  ctx: AggregateContext,
  limits = { interests: 25, pairs: 15, clusters: 8, suggestions: 15 },
): { neverTogether: TestPair[]; clusterOnClient: ClusterOnClient[]; medianCpr: number | null } {
  const strong = rankedInterests.filter((i) => !i.thin && i.cpr != null).slice(0, limits.interests);
  const together = new Set<string>();
  for (const a of adSets) {
    const ids = a.interests.map((i) => i.id);
    for (const x of ids) for (const y of ids) if (x < y) together.add(`${x}|${y}`);
  }
  const neverTogether: TestPair[] = [];
  for (let i = 0; i < strong.length; i += 1) {
    for (let j = i + 1; j < strong.length; j += 1) {
      const [x, y] = [strong[i], strong[j]];
      const pair = x.id < y.id ? `${x.id}|${y.id}` : `${y.id}|${x.id}`;
      if (together.has(pair)) continue;
      const shared = x.clients.filter((c) => y.clients.includes(c));
      if (!shared.length) continue;
      neverTogether.push({
        a: { id: x.id, name: x.name, cpr: x.cpr },
        b: { id: y.id, name: y.name, cpr: y.cpr },
        sharedClients: shared,
      });
    }
  }
  const nonThin = rankedClusters.filter((c) => !c.thin && c.cpr != null);
  const cprs = nonThin.map((c) => c.cpr as number).sort((a, b) => a - b);
  const medianCpr = cprs.length ? cprs[Math.floor((cprs.length - 1) / 2)] : null;
  const byClient = new Map<string, AnalysisAdSet[]>();
  for (const a of adSets) {
    if (!a.interests.length) continue;
    const list = byClient.get(a.clientName) ?? [];
    list.push(a);
    byClient.set(a.clientName, list);
  }
  const clientClusters = new Map<string, ClusterStats[]>();
  for (const [client, list] of byClient) clientClusters.set(client, buildClusters(list, ctx));
  const clusterOnClient: ClusterOnClient[] = [];
  for (const c of nonThin.slice(0, limits.clusters)) {
    for (const [client, clusters] of clientClusters) {
      if (c.clients.includes(client)) continue;
      const siblings = clusters
        .filter((s) => s.key !== c.key && s.cpr != null && medianCpr != null && s.cpr <= medianCpr)
        .map((s) => ({ s, j: jaccard(s.interestIds, c.interestIds) }))
        .filter((x) => x.j >= 0.5)
        .sort((x, y) => (x.s.cpr as number) - (y.s.cpr as number));
      const best = siblings[0];
      if (!best) continue;
      clusterOnClient.push({
        clusterKey: c.key,
        clusterName: c.name,
        clusterCpr: c.cpr,
        cprSource: c.cprSource,
        client,
        sibling: {
          key: best.s.key,
          name: best.s.name,
          cprOnClient: best.s.cpr as number,
          adSetsOnClient: best.s.adSets,
          jaccard: round(best.j, 2),
        },
      });
    }
  }
  return {
    neverTogether: neverTogether.slice(0, limits.pairs),
    clusterOnClient: clusterOnClient.slice(0, limits.suggestions),
    medianCpr,
  };
}

// ─── First-party join ─────────────────────────────────────────────────────────

export interface UtmRow {
  page_slug: string | null;
  crm_base_tag: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  meta_sourced: boolean;
  count: number;
}

export function parseUtmCsv(text: string): UtmRow[] {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      lines.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    lines.push(row);
  }
  const [header, ...body] = lines.filter((l) => l.length > 1 || l[0]);
  const idx = (name: string) => header.indexOf(name);
  const get = (l: string[], name: string) => (idx(name) >= 0 ? l[idx(name)] ?? "" : "");
  return body.map((l) => ({
    page_slug: get(l, "page_slug") || null,
    crm_base_tag: get(l, "crm_base_tag") || null,
    utm_campaign: get(l, "utm_campaign") || null,
    utm_content: get(l, "utm_content") || null,
    meta_sourced: get(l, "meta_sourced") === "true",
    count: Number(get(l, "count")) || 0,
  }));
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export interface CampaignFirstParty {
  campaignId: string;
  campaignName: string;
  accountId: string;
  clientName: string;
  matchedBy: "campaign_id" | "campaign_name";
  pixelRegistrations: number;
  pixelActionType: RegActionType | null;
  firstPartySignups: number;
  ratioFirstPartyToPixel: number | null;
  /** utm_content resolved to an ad set id or name for these signups. */
  adSetMatchedSignups: number;
  adSetLevel: "per_ad_set" | "campaign-level only";
  /** utm_content resolved, but first-party ÷ pixel sat outside FIRST_PARTY_RATIO_RANGE, so ad sets were not credited. */
  ratioOutOfRange: boolean;
}

/**
 * utm_campaign ↔ campaign id or name; utm_content ↔ ad set id or name
 * inside that campaign. A campaign whose utm_content never resolves is
 * "campaign-level only" and its ad sets get no first-party number.
 */
export function joinFirstParty(
  registrationAdSets: readonly AnalysisAdSet[],
  rows: readonly UtmRow[],
  ctx: Pick<AggregateContext, "chosenType">,
): { campaigns: CampaignFirstParty[]; adSets: Record<string, FirstPartyAdSet>; unmatchedPaidRows: number; unmatchedPaidSignups: number } {
  const campaigns = new Map<string, AnalysisAdSet[]>();
  for (const a of registrationAdSets) {
    const list = campaigns.get(a.campaignId) ?? [];
    list.push(a);
    campaigns.set(a.campaignId, list);
  }
  const byName = new Map<string, string[]>();
  for (const [id, list] of campaigns) {
    const key = norm(list[0].campaignName);
    byName.set(key, [...(byName.get(key) ?? []), id]);
  }
  const perCampaign = new Map<string, { rows: UtmRow[]; matchedBy: "campaign_id" | "campaign_name" }>();
  let unmatchedPaidRows = 0;
  let unmatchedPaidSignups = 0;
  for (const r of rows) {
    const c = (r.utm_campaign ?? "").trim();
    if (!c) continue;
    let id: string | null = campaigns.has(c) ? c : null;
    let matchedBy: "campaign_id" | "campaign_name" = "campaign_id";
    if (!id) {
      const named = byName.get(norm(c)) ?? [];
      if (named.length === 1) {
        id = named[0];
        matchedBy = "campaign_name";
      }
    }
    if (!id) {
      unmatchedPaidRows += 1;
      unmatchedPaidSignups += r.count;
      continue;
    }
    const entry = perCampaign.get(id) ?? { rows: [], matchedBy };
    entry.rows.push(r);
    perCampaign.set(id, entry);
  }
  const adSetFp: Record<string, FirstPartyAdSet> = {};
  const out: CampaignFirstParty[] = [];
  for (const [campaignId, entry] of perCampaign) {
    const list = campaigns.get(campaignId)!;
    const byId = new Map(list.map((a) => [a.id, a]));
    const byAdSetName = new Map<string, AnalysisAdSet[]>();
    for (const a of list) byAdSetName.set(norm(a.name), [...(byAdSetName.get(norm(a.name)) ?? []), a]);
    const counts = new Map<string, number>();
    let adSetMatched = 0;
    for (const r of entry.rows) {
      const content = (r.utm_content ?? "").trim();
      const hit = byId.get(content) ?? ((byAdSetName.get(norm(content)) ?? []).length === 1 ? byAdSetName.get(norm(content))![0] : undefined);
      if (!hit) continue;
      counts.set(hit.id, (counts.get(hit.id) ?? 0) + r.count);
      adSetMatched += r.count;
    }
    const pixelType = ctx.chosenType[list[0].accountId] ?? null;
    const pixel = pixelType ? list.reduce((s, a) => s + (a.regActions[pixelType] ?? 0), 0) : 0;
    const fp = entry.rows.reduce((s, r) => s + r.count, 0);
    const ratio = pixel > 0 ? fp / pixel : null;
    const plausible = ratio != null && ratio >= FIRST_PARTY_RATIO_RANGE[0] && ratio <= FIRST_PARTY_RATIO_RANGE[1];
    const perAdSet = adSetMatched > 0 && plausible;
    if (perAdSet) for (const a of list) adSetFp[a.id] = { signups: counts.get(a.id) ?? 0 };
    out.push({
      campaignId,
      campaignName: list[0].campaignName,
      accountId: list[0].accountId,
      clientName: list[0].clientName,
      matchedBy: entry.matchedBy,
      pixelRegistrations: pixel,
      pixelActionType: pixelType,
      firstPartySignups: fp,
      ratioFirstPartyToPixel: ratio == null ? null : round(ratio, 3),
      adSetMatchedSignups: adSetMatched,
      adSetLevel: perAdSet ? "per_ad_set" : "campaign-level only",
      ratioOutOfRange: adSetMatched > 0 && !plausible,
    });
  }
  out.sort((a, b) => b.firstPartySignups - a.firstPartySignups || a.campaignId.localeCompare(b.campaignId));
  return { campaigns: out, adSets: adSetFp, unmatchedPaidRows, unmatchedPaidSignups };
}

// ─── Report rendering (from the JSON only) ────────────────────────────────────

export interface InterestReportJson {
  generatedAt: string;
  since: string | null;
  fx: { base: "GBP"; rates: Record<string, number>; source: string; date: string };
  accounts: { id: string; name: string | null; currency: string | null; read: boolean; error?: string; adSets: number; notInLaunchedAdSets: boolean }[];
  totals: {
    adSets: number;
    registrationAdSets: number;
    registrationWithInterests: number;
    registrationWithoutInterests: number;
    excludedByPhase: Record<string, number>;
    reasons: Record<string, number>;
    appLaunched: number;
    manual: number;
    backfill: number;
  };
  actionTypes: AccountActionFinding[];
  clusters: ClusterStats[];
  ranked: string[];
  perClient: {
    client: string;
    ranked: string[];
    clusters: ClusterStats[];
    nonThin: number;
    /** See {@link clientMedianCpr}. */
    medianCpr: number | null;
  }[];
  interests: InterestStats[];
  rankedInterests: string[];
  noActions: { id: string; name: string; accountId: string; campaignName: string; spend: number; currency: string; hasInsights: boolean }[];
  firstParty: {
    source: string;
    campaigns: CampaignFirstParty[];
    unmatchedPaidRows: number;
    unmatchedPaidSignups: number;
    events: {
      eventCode: string;
      crmBaseTag: string;
      metaSourcedSignups: number;
      allSignups: number;
      paidTaggedSignups: number;
      pixelRegistrations: number;
      campaigns: number;
    }[];
    localEventSignups: { eventId: string; total: number; metaSourced: number; utmCampaigns: string[]; utmContents: string[] }[];
  };
  testNext: ReturnType<typeof whatToTestNext>;
}

function gbp(value: number | null): string {
  if (value == null) return "—";
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function interestLabel(interests: readonly InterestRef[], max = 6): string {
  const names = interests.map((i) => i.name ?? `#${i.id}`);
  return names.length > max ? `${names.slice(0, max).join(", ")} +${names.length - max}` : names.join(", ");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function clusterTable(rows: readonly ClusterStats[]): string[] {
  const lines = [
    "| # | Cluster (most common name) | Interests | Ad sets | Campaigns | Clients | Spend (GBP) | Regs | CPR | Source | Regs/£100 | CTR | App / manual | With CA / other type | Dates |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  rows.forEach((c, i) => {
    const native = Object.entries(c.spendByCurrency)
      .filter(([cur]) => cur !== "GBP")
      .map(([cur, v]) => `${cur} ${v.toLocaleString("en-GB")}`)
      .join(", ");
    lines.push(
      `| ${i + 1} | ${cell(c.name)} | ${cell(interestLabel(c.interests))} (${c.interestIds.length}) | ${c.adSets} | ${c.campaigns} | ${c.clients.length} | ${gbp(c.spendGbp)}${native ? ` (${native})` : ""} | ${c.cprSource === "first_party" ? `${c.fpSignups} fp / ${c.registrations} px` : c.registrations} | ${gbp(c.cpr)} | ${c.cprSource === "first_party" ? "first-party" : "pixel"} | ${c.regsPer100Gbp} | ${c.ctr == null ? "—" : `${c.ctr}%`} | ${c.appLaunched} / ${c.manual} | ${c.withCustomAudiences} / ${c.otherTypeOnly} | ${(c.firstStart ?? "").slice(0, 10)} → ${(c.lastEnd ?? "").slice(0, 10)} |`,
    );
  });
  return lines;
}

export function renderInterestReport(json: InterestReportJson): string {
  const byKey = new Map(json.clusters.map((c) => [c.key, c]));
  const ranked = json.ranked.map((k) => byKey.get(k)!).filter(Boolean);
  const nonThin = ranked.filter((c) => !c.thin);
  const interestById = new Map(json.interests.map((i) => [i.id, i]));
  const out: string[] = [];
  out.push(`# Interest-cluster performance — registration phase`);
  out.push("");
  out.push(
    `Generated ${json.generatedAt}${json.since ? ` · ad sets starting on or after ${json.since}` : ""} · source data: \`${json.generatedAt.slice(0, 10)}\` JSON beside this file. Read-only against Meta, prod and Cirqlin.`,
  );
  out.push("");
  out.push(
    `GBP normalisation: ${Object.entries(json.fx.rates)
      .filter(([c]) => c !== "GBP")
      .map(([c, r]) => `1 ${c} = £${r}`)
      .join(", ")} (${json.fx.source}, ${json.fx.date}). Reach is summed across ad sets and is not deduplicated.`,
  );
  out.push("");
  const t = json.totals;
  out.push(`## Scope`);
  out.push("");
  out.push(
    `${t.adSets} ad sets read across ${json.accounts.filter((a) => a.read).length} accounts. ${t.registrationAdSets} are registration phase (${Object.entries(t.reasons)
      .map(([r, n]) => `${n} by ${r.replace(/_/g, " ")}`)
      .join(", ")}). ${t.registrationWithInterests} of those carry interests and are clustered; ${t.registrationWithoutInterests} have no interests. ${t.appLaunched} registration ad sets were launched by the app (${t.backfill} from the launch-summary backfill), ${t.manual} were not launched by the app.`,
  );
  out.push("");
  out.push(
    `Thin = fewer than ${THIN_MIN_AD_SETS} ad sets or under £${THIN_MIN_SPEND_GBP} spend. Ranking: non-thin clusters by first-party CPR where UTM-measured ad sets cover at least ${FIRST_PARTY_MIN_COVERAGE * 100}% of the cluster's spend, else pixel CPR; registrations per £100 breaks ties. The Source column says which.`,
  );
  out.push("");
  out.push(
    `"With CA / other type": ad sets in the cluster that also targeted a custom audience (so not interest-only), and ad sets that reported only a registration type other than their account's chosen one (counted as 0 registrations here).`,
  );
  out.push("");
  out.push(`## Top 15 clusters (non-thin)`);
  out.push("");
  out.push(...clusterTable(nonThin.slice(0, 15)));
  out.push("");
  out.push(`## Per client — top 5 non-thin clusters`);
  out.push("");
  for (const pc of json.perClient) {
    const map = new Map(pc.clusters.map((c) => [c.key, c]));
    const top = pc.ranked.map((k) => map.get(k)!).filter((c) => c && !c.thin).slice(0, 5);
    out.push(`### ${pc.client}`);
    out.push("");
    out.push(`Client median CPR ${gbp(pc.medianCpr ?? null)} (median of non-thin cluster CPRs; all clusters when none is non-thin).`);
    out.push("");
    if (!top.length) {
      out.push(`No non-thin cluster (${pc.clusters.length} clusters, all thin).`);
      out.push("");
      continue;
    }
    out.push(...clusterTable(top));
    out.push("");
  }
  out.push(`## Top 20 interests (non-thin, ad sets containing the interest)`);
  out.push("");
  out.push(
    "Spend and registrations are the full totals of every ad set that targeted the interest. The equal-share columns split each ad set's spend and registrations evenly across its interests — an estimate, not a measurement.",
  );
  out.push("");
  out.push("| # | Interest | Id | Ad sets | Clusters | Alone | Spend (GBP) | Regs (pixel) | CPR (pixel) | Regs/£100 | Equal-share spend | Equal-share regs | Clients |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  json.rankedInterests
    .map((id) => interestById.get(id)!)
    .filter((i) => i && !i.thin)
    .slice(0, 20)
    .forEach((i, n) => {
      out.push(
        `| ${n + 1} | ${cell(i.name ?? "(no name)")} | ${i.id} | ${i.adSets} | ${i.clusters} | ${i.aloneAdSets} | ${gbp(i.spendGbp)} | ${i.registrations} | ${gbp(i.cpr)} | ${i.regsPer100Gbp} | ${gbp(i.equalShareSpendGbp)} | ${i.equalShareRegistrations} | ${cell(i.clients.join(", "))} |`,
      );
    });
  out.push("");
  out.push(`## Per-account registration action type`);
  out.push("");
  out.push("One type per account; the others are listed, never summed. Rule: the candidate with the largest total across the account's registration ad sets; tie → complete_registration, then the pixel type, then lead. Cells are ad sets with a non-zero value / total. Where complete_registration and the pixel type match exactly, Meta is reporting the same pixel events under two names.");
  out.push("");
  out.push("| Account | Reg ad sets | complete_registration | offsite_conversion.fb_pixel_complete_registration | lead | Chosen | Ad sets with only another type |");
  out.push("|---|---|---|---|---|---|---|");
  for (const f of json.actionTypes) {
    const p = (type: RegActionType) => `${f.populated[type].adSets} sets / ${f.populated[type].total}`;
    out.push(
      `| ${cell(f.accountName)} (${f.accountId}) | ${f.registrationAdSets} | ${p("complete_registration")} | ${p("offsite_conversion.fb_pixel_complete_registration")} | ${p("lead")} | ${f.chosen ?? "none"} | ${f.otherTypeOnly} |`,
    );
  }
  out.push("");
  out.push(`## Pixel vs first-party, per campaign`);
  out.push("");
  out.push(
    `First-party = Cirqlin signups (spam_verdict ok) whose utm_campaign is the Meta campaign id or name (${json.firstParty.source}). Ratio = first-party ÷ pixel. "per_ad_set" means utm_content resolved to ad sets in that campaign; otherwise the figure is campaign-level only and no ad set gets a first-party number. Ad sets are credited only when the ratio is between ${FIRST_PARTY_RATIO_RANGE[0]} and ${FIRST_PARTY_RATIO_RANGE[1]}; outside that the UTM text is usually static, copied from a duplicated campaign, and utm_content names ad sets that did not drive the clicks (marked "ratio out of range"). ${json.firstParty.unmatchedPaidSignups} signups in ${json.firstParty.unmatchedPaidRows} rows carry a utm_campaign that matches no registration campaign read here.`,
  );
  out.push("");
  out.push("| Campaign | Client | Matched by | Pixel regs | Action type | First-party | Ratio | Ad-set level |");
  out.push("|---|---|---|---|---|---|---|---|");
  for (const c of json.firstParty.campaigns) {
    out.push(
      `| ${cell(c.campaignName)} (${c.campaignId}) | ${cell(c.clientName)} | ${c.matchedBy.replace("_", " ")} | ${c.pixelRegistrations} | ${c.pixelActionType ?? "—"} | ${c.firstPartySignups} | ${c.ratioFirstPartyToPixel ?? "—"} | ${c.adSetLevel === "per_ad_set" ? `per ad set (${c.adSetMatchedSignups})` : c.ratioOutOfRange ? `campaign-level only — ratio out of range (${c.adSetMatchedSignups} matched)` : "campaign-level only"} |`,
    );
  }
  out.push("");
  if (json.firstParty.events.length) {
    out.push(`### Event level (crm_base_tag → events.mailchimp_tag → [event_code] campaigns)`);
    out.push("");
    out.push("Meta-sourced = fbclid seen at landing or utm_source facebook/instagram/meta. That includes organic Instagram link-in-bio clicks, so it is an upper bound on paid signups. Paid-tagged = utm_campaign present.");
    out.push("");
    out.push("| Event code | Cirqlin tag | All signups | Meta-sourced | Paid-tagged | Pixel regs (reg campaigns) | Campaigns |");
    out.push("|---|---|---|---|---|---|---|");
    for (const e of json.firstParty.events) {
      out.push(`| ${cell(e.eventCode)} | ${cell(e.crmBaseTag)} | ${e.allSignups} | ${e.metaSourcedSignups} | ${e.paidTaggedSignups} | ${e.pixelRegistrations} | ${e.campaigns} |`);
    }
    out.push("");
  }
  out.push(`### This repo's event_signups`);
  out.push("");
  if (!json.firstParty.localEventSignups.length) out.push("No rows.");
  for (const e of json.firstParty.localEventSignups) {
    out.push(`- event ${e.eventId}: ${e.total} signups, ${e.metaSourced} meta-sourced, utm_campaign values ${e.utmCampaigns.length}, utm_content values ${e.utmContents.length}`);
  }
  out.push("");
  out.push(`## Ad sets whose insights returned no actions`);
  out.push("");
  out.push(`${json.noActions.length} registration ad sets with spend and no actions array (or no insights at all).`);
  out.push("");
  if (json.noActions.length) {
    out.push("| Ad set | Campaign | Account | Spend | Insights row |");
    out.push("|---|---|---|---|---|");
    for (const a of json.noActions) {
      out.push(`| ${cell(a.name)} (${a.id}) | ${cell(a.campaignName)} | ${a.accountId} | ${a.currency} ${a.spend} | ${a.hasInsights ? "yes" : "no"} |`);
    }
    out.push("");
  }
  out.push(`## Accounts`);
  out.push("");
  out.push("| Account | Name | Currency | Read | Ad sets | Not in launched_ad_sets |");
  out.push("|---|---|---|---|---|---|");
  for (const a of json.accounts) {
    out.push(`| ${a.id} | ${cell(a.name ?? "—")} | ${a.currency ?? "—"} | ${a.read ? "yes" : `no — ${cell(a.error ?? "")}`} | ${a.adSets} | ${a.notInLaunchedAdSets ? "yes" : ""} |`);
  }
  const refused = json.accounts.filter((a) => !a.read);
  out.push("");
  out.push(refused.length ? `The token could not read: ${refused.map((a) => `${a.id} (${a.error})`).join("; ")}.` : "The token read every account.");
  out.push("");
  out.push(`## Thin clusters`);
  out.push("");
  const thin = ranked.filter((c) => c.thin);
  out.push(`${thin.length} thin clusters. Listed by pixel CPR; too little data to rank.`);
  out.push("");
  out.push("| Cluster | Interests | Ad sets | Spend (GBP) | Regs | CPR | Clients |");
  out.push("|---|---|---|---|---|---|---|");
  for (const c of thin) {
    out.push(`| ${cell(c.name)} | ${cell(interestLabel(c.interests, 4))} (${c.interestIds.length}) | ${c.adSets} | ${gbp(c.spendGbp)} | ${c.registrations} | ${gbp(c.cpr)} | ${cell(c.clients.join(", "))} |`);
  }
  out.push("");
  out.push(`## What to test next`);
  out.push("");
  out.push(`### Strong interests never targeted together`);
  out.push("");
  out.push("Pairs from the top 25 non-thin interests (pixel CPR of ad sets containing each) that the same client has run, but never in one ad set.");
  out.push("");
  if (!json.testNext.neverTogether.length) out.push("Every such pair has already run in one ad set.");
  for (const p of json.testNext.neverTogether) {
    out.push(`- ${p.a.name ?? p.a.id} (${gbp(p.a.cpr)}) + ${p.b.name ?? p.b.id} (${gbp(p.b.cpr)}) — both run separately for ${p.sharedClients.join(", ")}`);
  }
  out.push("");
  out.push(`### Strong clusters not yet run for a client where a similar cluster worked`);
  out.push("");
  out.push(`Similar = Jaccard ≥ 0.5 on interest ids. Worked = that client's CPR for the similar cluster ≤ the median non-thin CPR (${gbp(json.testNext.medianCpr)}).`);
  out.push("");
  if (!json.testNext.clusterOnClient.length) out.push("No such pairs in the data.");
  for (const s of json.testNext.clusterOnClient) {
    out.push(
      `- Try **${s.clusterName}** (${gbp(s.clusterCpr)} ${s.cprSource === "first_party" ? "first-party" : "pixel"}) on **${s.client}** — its sibling ${s.sibling.name} ran ${s.sibling.adSetsOnClient} ad sets there at ${gbp(s.sibling.cprOnClient)} (Jaccard ${s.sibling.jaccard}).`,
    );
  }
  out.push("");
  out.push(`## Footnote — ad sets outside the registration phase`);
  out.push("");
  out.push(
    Object.entries(t.excludedByPhase)
      .map(([k, n]) => `${k}: ${n}`)
      .join(" · ") || "None.",
  );
  out.push("");
  return out.join("\n");
}

/**
 * A client's typical CPR: the median CPR of its non-thin clusters, or of
 * all its clusters with a CPR when none is non-thin. Even counts average
 * the middle two.
 */
export function clientMedianCpr(clusters: readonly ClusterStats[]): number | null {
  const withCpr = clusters.filter((c) => c.cpr != null);
  const nonThin = withCpr.filter((c) => !c.thin);
  const pool = (nonThin.length ? nonThin : withCpr).map((c) => c.cpr as number).sort((a, b) => a - b);
  if (!pool.length) return null;
  const mid = pool.length / 2;
  return round(pool.length % 2 ? pool[Math.floor(mid)] : (pool[mid - 1] + pool[mid]) / 2);
}

export type SeedVertical = "music" | "football" | "other";

/** One curated row in the seed-keys file. */
export interface SeedKey {
  /** Cluster key in the report JSON (sorted interest ids, comma-joined). */
  key: string;
  name: string;
  vertical: SeedVertical;
  /** Take evidence from this client's slice of the cluster only. */
  client?: string;
  confidence?: "thin";
  /** Interests left out of the seeded group; evidence stays as measured with them. */
  drop?: { id: string; reason: string }[];
  note?: string;
}

export interface SeedCluster {
  name: string;
  vertical: SeedVertical;
  interestIds: string[];
  interests: { id: string; name: string }[];
  evidence: {
    clusterKey: string;
    adSets: number;
    spend: number;
    registrations: number;
    cpr: number | null;
    cprSource: "first_party" | "pixel";
    clients: string[];
    /** Cluster CPR ÷ the spend-weighted median CPR of its clients. Below 1 beats the client's norm. */
    cprIndex: number | null;
    clientMedianCpr: number | null;
    confidence?: "thin";
    note?: string;
    dropped?: { id: string; name: string; reason: string }[];
  };
}

/**
 * Seed rows from curated keys, in the file's order. Evidence and
 * interest names come from the report JSON; a key missing from it throws.
 * Spend and CPR are GBP.
 */
export function seedFromKeys(json: InterestReportJson, keys: readonly SeedKey[]): SeedCluster[] {
  const byKey = new Map(json.clusters.map((c) => [c.key, c]));
  const perClient = new Map(json.perClient.map((pc) => [pc.client, pc]));
  const sliceOf = (client: string, key: string) => perClient.get(client)?.clusters.find((c) => c.key === key);
  return keys.map((k) => {
    const whole = byKey.get(k.key);
    if (!whole) throw new Error(`Seed key not in report: ${k.name} (${k.key})`);
    const c = k.client ? sliceOf(k.client, k.key) : whole;
    if (!c) throw new Error(`Seed key ${k.name} has no slice for client ${k.client}`);
    let weighted = 0;
    let weight = 0;
    for (const client of c.clients) {
      const median = perClient.get(client)?.medianCpr ?? null;
      const spend = sliceOf(client, k.key)?.spendGbp ?? 0;
      if (median == null || spend <= 0) continue;
      weighted += median * spend;
      weight += spend;
    }
    const clientMedian = weight > 0 ? round(weighted / weight) : null;
    const dropIds = new Set((k.drop ?? []).map((d) => d.id));
    for (const id of dropIds) {
      if (!c.interestIds.includes(id)) throw new Error(`Seed key ${k.name}: drop id ${id} not in cluster`);
    }
    const interests = c.interests.map((i) => ({ id: i.id, name: i.name ?? i.id }));
    return {
      name: k.name,
      vertical: k.vertical,
      interestIds: c.interestIds.filter((id) => !dropIds.has(id)),
      interests: interests.filter((i) => !dropIds.has(i.id)),
      evidence: {
        clusterKey: k.key,
        adSets: c.adSets,
        spend: c.spendGbp,
        registrations: c.cprSource === "first_party" ? c.fpSignups : c.registrations,
        cpr: c.cpr,
        cprSource: c.cprSource,
        clients: c.clients,
        cprIndex: c.cpr != null && clientMedian ? round(c.cpr / clientMedian) : null,
        clientMedianCpr: clientMedian,
        ...(k.confidence ? { confidence: k.confidence } : {}),
        ...(k.note ? { note: k.note } : {}),
        ...(k.drop?.length
          ? {
              dropped: k.drop.map((d) => ({
                id: d.id,
                name: interests.find((i) => i.id === d.id)?.name ?? d.id,
                reason: d.reason,
              })),
            }
          : {}),
      },
    };
  });
}
