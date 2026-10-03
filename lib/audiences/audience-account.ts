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

export function foreignAudienceRefusals(
  refs: readonly AudienceAccountRef[],
  accountIdByAudienceId: Readonly<Record<string, string | undefined>>,
  launchAdAccountId: string,
): string | null {
  const lines: string[] = [];
  for (const ref of refs) {
    const accountId = accountIdByAudienceId[ref.id];
    if (!accountId || !audienceAccountMismatch(accountId, launchAdAccountId)) continue;
    lines.push(
      foreignAudienceRefusal({
        name: ref.name,
        id: ref.id,
        audienceAccountId: accountId,
      }),
    );
  }
  return lines.length > 0 ? lines.join(" ") : null;
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
