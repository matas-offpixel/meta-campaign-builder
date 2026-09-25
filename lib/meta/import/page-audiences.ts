import { parseAppUsageHeader } from "../app-usage.ts";
import { buildMultiGetBatch, collectMultiGetResponses } from "../graph-multi-get-parse.ts";
import type { GraphBatchSubResponse } from "../graph-multi-get-parse.ts";
import type {
  CampaignDraft,
  CustomAudienceGroup,
  EngagementType,
  PageAudienceGroup,
} from "../../types.ts";

/** 25 per call. 72 audiences is three calls, not 72. */
export const AUDIENCE_RULE_BATCH_SIZE = 25;

/** Stop before the next batch once app usage is this hot. */
export const AUDIENCE_RULE_USAGE_STOP_PERCENT = 80;

export const AUDIENCE_RULE_FIELDS = "id,name,subtype,rule";

/**
 * The four labels `launch-campaign` writes, in `${pageName} — ${label}`.
 * `sanitizeAudienceName` strips the em dash, so Meta stores two spaces.
 */
const ENGAGEMENT_LABELS = [
  "FB Likes",
  "FB Engagement 365d",
  "IG Followers",
  "IG Engagement 365d",
] as const;

const LABEL_PATTERN = ENGAGEMENT_LABELS.map((label) => label.replace(/ /g, "\\ ")).join("|");

const ENGAGEMENT_NAME = new RegExp(`^(.+?)(?: — |  )(${LABEL_PATTERN})$`);

export type PageDerivedName = { page: string; engagement: string };

/** A name this app wrote. Enough to label, not enough to rebuild a page group. */
export function pageDerivedFromName(name: string | null | undefined): PageDerivedName | null {
  const match = name?.trim().match(ENGAGEMENT_NAME);
  if (!match) return null;
  const page = match[1]?.trim() ?? "";
  const engagement = match[2] ?? "";
  if (!page || !engagement) return null;
  return { page, engagement };
}

export function pageDerivedBadge(name: string | null | undefined): string | null {
  const parsed = pageDerivedFromName(name);
  if (!parsed) return null;
  return `page-derived · ${parsed.page}`;
}

const EVENT_TO_ENGAGEMENT: Record<string, EngagementType> = {
  page_liked: "fb_likes",
  page_engaged: "fb_engagement_365d",
};

export type AudienceRuleRead = {
  id: string;
  name: string | null;
  subtype: string | null;
  rule: unknown;
};

export type ResolvedPageAudience = {
  audienceId: string;
  pageId: string;
  engagementType: EngagementType;
  pageName: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRule(rule: unknown): Record<string, unknown> | null {
  if (typeof rule === "string") {
    try {
      return asRecord(JSON.parse(rule));
    } catch {
      return null;
    }
  }
  return asRecord(rule);
}

/**
 * A page id from `event_sources` of type `page`, and the engagement type
 * from the event filter. An Instagram business id is not a page id.
 * More than one page id does not resolve.
 */
export function resolvePageAudience(read: AudienceRuleRead): ResolvedPageAudience | null {
  const rule = parseRule(read.rule);
  if (!rule) return null;
  const inclusions = asRecord(rule.inclusions);
  const rules = Array.isArray(inclusions?.rules) ? inclusions.rules : [];
  const pageIds = new Set<string>();
  let engagementType: EngagementType | null = null;
  for (const entry of rules) {
    const row = asRecord(entry);
    const sources = Array.isArray(row?.event_sources) ? row.event_sources : [];
    for (const source of sources) {
      const item = asRecord(source);
      if (item?.type !== "page") continue;
      const id = item.id;
      const pageId = typeof id === "number" || typeof id === "string" ? String(id).trim() : "";
      if (pageId) pageIds.add(pageId);
    }
    const filter = asRecord(row?.filter);
    const filters = Array.isArray(filter?.filters) ? filter.filters : [];
    for (const raw of filters) {
      const item = asRecord(raw);
      if (item?.field !== "event") continue;
      const mapped = EVENT_TO_ENGAGEMENT[String(item.value ?? "")];
      if (mapped) engagementType = mapped;
    }
  }
  if (pageIds.size !== 1 || !engagementType) return null;
  const named = pageDerivedFromName(read.name);
  return {
    audienceId: read.id,
    pageId: [...pageIds][0]!,
    engagementType,
    pageName: named?.page ?? null,
  };
}

export type AudienceRuleBatch = {
  responses: readonly (GraphBatchSubResponse | null | undefined)[];
  usageHeader: string | null;
};

/**
 * ⌈n/25⌉ batch calls. Stops before the next call when `X-App-Usage` is
 * at or above the stop line, or when a sub-request comes back throttled.
 * Audiences not read are simply absent from the result.
 */
export async function readCustomAudienceRules(input: {
  ids: readonly string[];
  postBatch: (batch: ReturnType<typeof buildMultiGetBatch>) => Promise<AudienceRuleBatch>;
}): Promise<{ reads: AudienceRuleRead[]; calls: number; stopped: "usage" | "throttled" | null }> {
  const unique = [...new Set(input.ids.filter(Boolean))];
  const reads: AudienceRuleRead[] = [];
  let calls = 0;
  let stopped: "usage" | "throttled" | null = null;
  for (let i = 0; i < unique.length; i += AUDIENCE_RULE_BATCH_SIZE) {
    const chunk = unique.slice(i, i + AUDIENCE_RULE_BATCH_SIZE);
    const batch = await input.postBatch(buildMultiGetBatch(chunk, AUDIENCE_RULE_FIELDS));
    calls += 1;
    const usage = parseAppUsageHeader(batch.usageHeader);
    const nodes = collectMultiGetResponses<Record<string, unknown>>(batch.responses);
    let throttled = false;
    for (const sub of batch.responses) {
      if (sub?.code === 4 || sub?.code === 17 || sub?.code === 80004) throttled = true;
    }
    for (const [id, node] of Object.entries(nodes)) {
      reads.push({
        id,
        name: typeof node.name === "string" ? node.name : null,
        subtype: typeof node.subtype === "string" ? node.subtype : null,
        rule: node.rule ?? null,
      });
    }
    if (throttled) {
      stopped = "throttled";
      break;
    }
    if (usage && usage.maxPercent >= AUDIENCE_RULE_USAGE_STOP_PERCENT && i + AUDIENCE_RULE_BATCH_SIZE < unique.length) {
      stopped = "usage";
      break;
    }
  }
  return { reads, calls, stopped };
}

function pageGroupFrom(pageId: string, resolved: readonly ResolvedPageAudience[]): PageAudienceGroup {
  const types: EngagementType[] = [];
  const audienceIds: string[] = [];
  let pageName: string | null = null;
  for (const row of resolved) {
    if (row.pageId !== pageId) continue;
    if (!types.includes(row.engagementType)) types.push(row.engagementType);
    if (!audienceIds.includes(row.audienceId)) audienceIds.push(row.audienceId);
    pageName = pageName ?? row.pageName;
  }
  return {
    id: `page:${pageId}`,
    name: pageName ?? pageId,
    pageIds: [pageId],
    engagementTypes: types,
    lookalike: false,
    lookalikeRanges: ["0-1%"],
    customAudienceIds: [],
    engagementAudienceIds: audienceIds,
    engagementAudienceStatuses: audienceIds.map((id) => {
      const row = resolved.find((item) => item.audienceId === id)!;
      return {
        id,
        type: row.engagementType,
        pageId,
        pageName: pageName ?? undefined,
        createdAt: "",
        readyForLookalike: false,
        populating: false,
      };
    }),
  };
}

function withoutMoved(
  group: CustomAudienceGroup,
  moved: ReadonlySet<string>,
): CustomAudienceGroup | null {
  const audienceIds = group.audienceIds.filter((id) => !moved.has(id));
  if (audienceIds.length === 0) return null;
  if (audienceIds.length === group.audienceIds.length) return group;
  const audienceNames = group.audienceNames
    ? Object.fromEntries(Object.entries(group.audienceNames).filter(([id]) => !moved.has(id)))
    : undefined;
  return { ...group, audienceIds, audienceNames };
}

/**
 * Move audiences whose rule resolved to a page onto page groups, and
 * take them out of every custom group. Unresolved audiences stay put.
 */
export function applyResolvedPageAudiences(
  draft: CampaignDraft,
  reads: readonly AudienceRuleRead[],
): CampaignDraft {
  const resolved = reads
    .map(resolvePageAudience)
    .filter((row): row is ResolvedPageAudience => row != null);
  if (resolved.length === 0) return draft;
  const moved = new Set(resolved.map((row) => row.audienceId));
  const pageIds = [...new Set(resolved.map((row) => row.pageId))];
  const existing = new Set(draft.audiences.pageGroups.map((group) => group.id));
  const pageGroups = [
    ...draft.audiences.pageGroups,
    ...pageIds
      .map((pageId) => pageGroupFrom(pageId, resolved))
      .filter((group) => !existing.has(group.id)),
  ];
  const customAudienceGroups = draft.audiences.customAudienceGroups
    .map((group) => withoutMoved(group, moved))
    .filter((group): group is CustomAudienceGroup => group != null);
  const surviving = new Set(customAudienceGroups.map((group) => group.id));
  const adSetSuggestions = draft.adSetSuggestions.map((adSet) => {
    if (adSet.sourceType !== "custom_group" || surviving.has(adSet.sourceId)) return adSet;
    const original = draft.audiences.customAudienceGroups.find((group) => group.id === adSet.sourceId);
    const pages = new Set(
      resolved
        .filter((row) => original?.audienceIds.includes(row.audienceId))
        .map((row) => row.pageId),
    );
    if (pages.size === 1) {
      const pageId = [...pages][0]!;
      return { ...adSet, sourceType: "page_group" as const, sourceId: `page:${pageId}` };
    }
    return { ...adSet, sourceType: "blank" as const, sourceId: "" };
  });
  return {
    ...draft,
    audiences: { ...draft.audiences, pageGroups, customAudienceGroups },
    adSetSuggestions,
  };
}
