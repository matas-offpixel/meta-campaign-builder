import type { CampaignDraft } from "../types.ts";
import { withoutActPrefix } from "../meta/ad-account-id.ts";

export interface AudienceAccountRef {
  id: string;
  name: string;
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
export function summariseForeignAudiences(input: {
  launchAdAccountId: string;
  items: readonly { name: string; accountId: string }[];
  accountNames?: ReadonlyMap<string, string>;
}): string | null {
  const groups = new Map<string, string[]>();
  for (const item of input.items) {
    const bare = withoutActPrefix(item.accountId);
    const names = groups.get(bare) ?? [];
    names.push(item.name.trim() || "Audience");
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
      `${count} ${noun} in this draft ${verb} to ${foreignLabel}, not ${launchLabel}: ${summariseNamedList(names)}. Rebuild them on this ad account or clear them on the Audiences step.`,
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
  const items: { name: string; accountId: string }[] = [];
  for (const ref of refs) {
    const accountId = accountIdByAudienceId[ref.id];
    if (!accountId || !audienceAccountMismatch(accountId, launchAdAccountId)) continue;
    items.push({ name: ref.name, accountId });
  }
  return summariseForeignAudiences({ launchAdAccountId, items, accountNames });
}

export function collectAudienceAccountRefs(draft: CampaignDraft): AudienceAccountRef[] {
  const byId = new Map<string, string>();
  const add = (id: string | undefined, name: string) => {
    if (!isMetaAudienceId(id) || byId.has(id)) return;
    byId.set(id, name.trim() || "Audience");
  };

  for (const group of draft.audiences.pageGroups) {
    const name = group.name || "Page group";
    for (const id of group.customAudienceIds) add(id, name);
    for (const id of group.engagementAudienceIds ?? []) add(id, name);
    for (const id of group.lookalikeAudienceIds ?? []) add(id, `${name} lookalike`);
    for (const status of group.engagementAudienceStatuses ?? []) {
      add(status.id, status.pageName ? `${status.pageName} — ${name}` : name);
      add(status.lookalikeId, `${name} lookalike`);
    }
  }
  for (const group of draft.audiences.customAudienceGroups) {
    const name = group.name || "Custom audience";
    for (const id of group.audienceIds) add(id, name);
    for (const list of Object.values(group.lookalikeAudienceIdsByRange ?? {})) {
      for (const id of list) add(id, `${name} lookalike`);
    }
  }
  for (const id of draft.audiences.savedAudiences.audienceIds) add(id, "Saved audience");
  for (const id of draft.audiences.offpixelCustomAudienceIds ?? []) add(id, "Off Pixel audience");
  for (const group of draft.audiences.selectedPagesLookalikeGroups) {
    const name = group.name || "Lookalike";
    for (const list of Object.values(group.engagementAudienceIdsByPage ?? {})) {
      for (const id of list) add(id, name);
    }
    for (const list of Object.values(group.lookalikeAudienceIdsByRange ?? {})) {
      for (const id of list) add(id, `${name} lookalike`);
    }
  }
  for (const adSet of draft.adSetSuggestions ?? []) {
    if (!adSet.enabled || adSet.sourceType !== "saved_audience") continue;
    add(adSet.sourceId, adSet.sourceName || adSet.name);
  }

  return [...byId].map(([id, name]) => ({ id, name }));
}
