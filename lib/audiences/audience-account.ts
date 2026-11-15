import type { AdSetSuggestion, AudienceSettings, CampaignDraft } from "../types.ts";
import { withoutActPrefix } from "../meta/ad-account-id.ts";
import { buildMetaTargeting } from "../meta/adset.ts";

export interface AudienceAccountRef {
  id: string;
  name: string;
  /** Set when the id is a lookalike, so the summary names the parent group once. */
  lookalikeGroup?: string;
}

const GROUP_SOURCE_TYPES = new Set<AdSetSuggestion["sourceType"]>([
  "page_group",
  "lookalike_group",
  "custom_group",
  "custom_group_lookalike",
  "selected_pages_lookalike",
]);

const LOOKALIKE_SOURCE_TYPES = new Set<AdSetSuggestion["sourceType"]>([
  "lookalike_group",
  "custom_group_lookalike",
  "selected_pages_lookalike",
]);

/** Group ids an enabled ad set will resolve through buildMetaTargeting. */
export function enabledAdSetSourceIds(
  adSets: readonly Pick<AdSetSuggestion, "enabled" | "sourceType" | "sourceId">[],
): Set<string> {
  const ids = new Set<string>();
  for (const adSet of adSets) {
    if (!adSet.enabled || !GROUP_SOURCE_TYPES.has(adSet.sourceType)) continue;
    if (adSet.sourceId) ids.add(adSet.sourceId);
  }
  return ids;
}

export const AUDIENCE_ACCOUNT_ID_LIMIT = 200;
const AUDIENCE_ID_RE = /^\d{10,}$/;

function isMetaAudienceId(id: string | undefined): id is string {
  return !!id && AUDIENCE_ID_RE.test(id);
}

/** Ids the audiences step may ask Graph about. Non-matching ids are dropped. */
export function parseAudienceAccountIds(
  raw: unknown,
): { ok: true; ids: string[] } | { ok: false; status: 400; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }
  const ids = [
    ...new Set(raw.map((id) => String(id).trim()).filter((id) => AUDIENCE_ID_RE.test(id))),
  ];
  if (ids.length > AUDIENCE_ACCOUNT_ID_LIMIT) {
    return { ok: false, status: 400, error: "Too many audiences" };
  }
  return { ok: true, ids };
}

/**
 * Ready means the audience exists in this ad account. Meta returns
 * `account_id` without the `act_` prefix; the draft stores `act_…`.
 */
export function audienceAccountMismatch(
  audienceAccountId: string | null | undefined,
  draftAdAccountId: string | null | undefined,
): boolean {
  const audience = withoutActPrefix((audienceAccountId ?? "").trim());
  const draft = withoutActPrefix((draftAdAccountId ?? "").trim());
  if (!audience || !draft) return false;
  return audience !== draft;
}

export function belongsToOtherAccountLabel(accountId: string): string {
  return `⚠ belongs to act_${withoutActPrefix(accountId)} — rebuild`;
}

export function audienceReadyState(
  status: { readyForLookalike: boolean; accountId?: string | null },
  draftAdAccountId: string | null | undefined,
): { ready: boolean; label: string } {
  if (status.accountId && audienceAccountMismatch(status.accountId, draftAdAccountId)) {
    return { ready: false, label: belongsToOtherAccountLabel(status.accountId) };
  }
  if (status.readyForLookalike) return { ready: true, label: "✓ ready" };
  return { ready: false, label: "created" };
}

export function foreignAudienceRefusal(input: {
  name: string;
  id: string;
  audienceAccountId: string;
}): string {
  const act = `act_${withoutActPrefix(input.audienceAccountId)}`;
  const name = input.name.trim() || input.id;
  return `Audience ${name} (${input.id}) belongs to ${act} — rebuild it on this ad account.`;
}

/** At most three names, then a count of the rest. */
export function summariseNamedList(names: readonly string[]): string {
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  if (rest <= 0) return shown.join(", ");
  return `${shown.join(", ")}, +${rest} more`;
}

function accountActLabel(
  accountId: string,
  accountNames?: ReadonlyMap<string, string>,
): string {
  const bare = withoutActPrefix(accountId);
  const act = `act_${bare}`;
  const name = accountNames?.get(bare) ?? accountNames?.get(act);
  return name ? `${act} (${name})` : act;
}

/**
 * One sentence for every audience that lives on another ad account.
 * Names at most three, then "+N more". Account names are parenthetical
 * only when the ad-account list resolved them.
 */
function summaryLabels(
  items: readonly { name: string; lookalikeGroup?: string }[],
): string[] {
  const labels: string[] = [];
  const lookalikeCounts = new Map<string, number>();
  const lookalikeOrder: string[] = [];
  for (const item of items) {
    if (!item.lookalikeGroup) {
      labels.push(item.name.trim() || "Audience");
      continue;
    }
    const count = lookalikeCounts.get(item.lookalikeGroup) ?? 0;
    if (count === 0) lookalikeOrder.push(item.lookalikeGroup);
    lookalikeCounts.set(item.lookalikeGroup, count + 1);
  }
  const lookalikeLabels = lookalikeOrder.map((group) => {
    const count = lookalikeCounts.get(group) ?? 0;
    const noun = count === 1 ? "lookalike" : "lookalikes";
    return `${group} (${count} ${noun})`;
  });
  return [...lookalikeLabels, ...labels];
}

export function summariseForeignAudiences(input: {
  launchAdAccountId: string;
  items: readonly { name: string; accountId: string; lookalikeGroup?: string }[];
  accountNames?: ReadonlyMap<string, string>;
}): string | null {
  const groups = new Map<string, { name: string; lookalikeGroup?: string }[]>();
  for (const item of input.items) {
    const bare = withoutActPrefix(item.accountId);
    const names = groups.get(bare) ?? [];
    names.push({ name: item.name.trim() || "Audience", lookalikeGroup: item.lookalikeGroup });
    groups.set(bare, names);
  }
  if (groups.size === 0) return null;
  const launchLabel = accountActLabel(input.launchAdAccountId, input.accountNames);
  const sentences: string[] = [];
  for (const [bare, names] of groups) {
    const count = names.length;
    const noun = count === 1 ? "audience" : "audiences";
    const verb = count === 1 ? "belongs" : "belong";
    const foreignLabel = accountActLabel(bare, input.accountNames);
    sentences.push(
      `${count} ${noun} in this draft ${verb} to ${foreignLabel}, not ${launchLabel}: ${summariseNamedList(summaryLabels(names))}. Rebuild them on this ad account or clear them on the Audiences step.`,
    );
  }
  return sentences.join(" ");
}

export function foreignAudienceRefusals(
  refs: readonly AudienceAccountRef[],
  accountIdByAudienceId: Readonly<Record<string, string | undefined>>,
  launchAdAccountId: string,
  accountNames?: ReadonlyMap<string, string>,
): string | null {
  const items: { name: string; accountId: string; lookalikeGroup?: string }[] = [];
  for (const ref of refs) {
    const accountId = accountIdByAudienceId[ref.id];
    if (!accountId || !audienceAccountMismatch(accountId, launchAdAccountId)) continue;
    items.push({ name: ref.name, accountId, lookalikeGroup: ref.lookalikeGroup });
  }
  return summariseForeignAudiences({ launchAdAccountId, items, accountNames });
}

function groupNameForAdSet(adSet: AdSetSuggestion, audiences: AudienceSettings): string {
  switch (adSet.sourceType) {
    case "custom_group":
    case "custom_group_lookalike":
      return (
        audiences.customAudienceGroups.find((group) => group.id === adSet.sourceId)?.name ||
        adSet.sourceName ||
        adSet.name ||
        "Custom audience"
      );
    case "page_group":
    case "lookalike_group":
      return (
        audiences.pageGroups.find((group) => group.id === adSet.sourceId)?.name ||
        adSet.sourceName ||
        adSet.name ||
        "Page group"
      );
    case "selected_pages_lookalike":
      return (
        audiences.selectedPagesLookalikeGroups.find((group) => group.id === adSet.sourceId)?.name ||
        adSet.sourceName ||
        adSet.name ||
        "Lookalike"
      );
    case "saved_audience":
      return adSet.sourceName || adSet.name || "Saved audience";
    default:
      return adSet.sourceName || adSet.name || "Audience";
  }
}

function labelForSentAudience(
  id: string,
  adSet: AdSetSuggestion,
  audiences: AudienceSettings,
  groupName: string,
): string {
  if (adSet.sourceType === "page_group" || adSet.sourceType === "lookalike_group") {
    const group = audiences.pageGroups.find((row) => row.id === adSet.sourceId);
    const status = group?.engagementAudienceStatuses?.find((row) => row.id === id);
    if (status?.pageName) return `${status.pageName} — ${groupName}`;
  }
  if (adSet.sourceType === "saved_audience") return adSet.sourceName || adSet.name || groupName;
  return groupName;
}

/**
 * Meta audience ids enabled ad sets will send. The ids come from
 * buildMetaTargeting, so a group no enabled row references is absent.
 */
export function collectAudienceAccountRefs(draft: CampaignDraft): AudienceAccountRef[] {
  const byId = new Map<string, AudienceAccountRef>();
  for (const adSet of draft.adSetSuggestions ?? []) {
    if (!adSet.enabled) continue;
    let targeting;
    try {
      targeting = buildMetaTargeting(adSet, draft.audiences);
    } catch (err) {
      console.error("[account-scope-preflight] targeting for audience refs failed:", err);
      continue;
    }
    const groupName = groupNameForAdSet(adSet, draft.audiences);
    const lookalike = LOOKALIKE_SOURCE_TYPES.has(adSet.sourceType);
    for (const audience of targeting.custom_audiences ?? []) {
      if (!isMetaAudienceId(audience.id) || byId.has(audience.id)) continue;
      byId.set(audience.id, {
        id: audience.id,
        name: labelForSentAudience(audience.id, adSet, draft.audiences, groupName),
        lookalikeGroup: lookalike ? groupName : undefined,
      });
    }
  }
  return [...byId.values()];
}
