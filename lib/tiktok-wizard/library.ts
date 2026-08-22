import { nextDuplicateName } from "../duplicate-name.ts";
import { TIKTOK_OBJECTIVE_LABELS } from "./campaign-setup.ts";
import { applyTikTokTemplate, snapshotTikTokDraft } from "./templates.ts";
import type { TikTokCampaignTemplate } from "./templates.ts";
import type {
  TikTokCampaignDraft,
  TikTokDraftStatus,
} from "../types/tiktok-draft.ts";

export type TikTokLibraryTab =
  | "drafts"
  | "published"
  | "archived"
  | "templates";

export interface TikTokLibraryDraftRow {
  draft: TikTokCampaignDraft;
  clientName: string | null;
  eventName: string | null;
}

export const TIKTOK_LIBRARY_DELETE_CONFIRM =
  "This deletes our Off Pixel record only. It does not pause or delete the campaign on TikTok.";

export function tikTokLibraryStatusForTab(
  tab: Exclude<TikTokLibraryTab, "templates">,
): TikTokDraftStatus {
  if (tab === "drafts") return "draft";
  if (tab === "published") return "published";
  return "archived";
}

export function tikTokLibraryTabCounts(
  drafts: readonly TikTokCampaignDraft[],
  templateCount: number,
): Record<TikTokLibraryTab, number> {
  return {
    drafts: drafts.filter((draft) => draft.status === "draft").length,
    published: drafts.filter((draft) => draft.status === "published").length,
    archived: drafts.filter((draft) => draft.status === "archived").length,
    templates: templateCount,
  };
}

export function matchesTikTokLibraryUpdatedFilter(
  updatedAt: string,
  filter: string | null,
): boolean {
  if (!filter) return true;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const days = ageMs / 86_400_000;
  if (filter === "7d") return days <= 7;
  if (filter === "30d") return days <= 30;
  if (filter === "older") return days > 30;
  return true;
}

export function filterTikTokLibraryDrafts(input: {
  rows: readonly TikTokLibraryDraftRow[];
  tab: Exclude<TikTokLibraryTab, "templates">;
  search: string;
  clientId?: string | null;
  eventId?: string | null;
  updated?: string | null;
}): TikTokLibraryDraftRow[] {
  const status = tikTokLibraryStatusForTab(input.tab);
  const query = input.search.trim().toLowerCase();
  return input.rows.filter((row) => {
    if (row.draft.status !== status) return false;
    if (input.clientId && row.draft.clientId !== input.clientId) return false;
    if (input.eventId && row.draft.eventId !== input.eventId) return false;
    if (!matchesTikTokLibraryUpdatedFilter(row.draft.updatedAt, input.updated ?? null)) {
      return false;
    }
    if (!query) return true;
    const objective = row.draft.campaignSetup.objective;
    const objectiveLabel = objective ? TIKTOK_OBJECTIVE_LABELS[objective] : "";
    const haystack = [
      row.draft.campaignSetup.campaignName,
      row.clientName,
      row.eventName,
      objective,
      objectiveLabel,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function filterTikTokLibraryTemplates(
  templates: readonly TikTokCampaignTemplate[],
  search: string,
): TikTokCampaignTemplate[] {
  const query = search.trim().toLowerCase();
  if (!query) return [...templates];
  return templates.filter(
    (template) =>
      template.name.toLowerCase().includes(query) ||
      template.description.toLowerCase().includes(query) ||
      template.tags.some((tag) => tag.toLowerCase().includes(query)),
  );
}

/** Names already on drafts the operator can see for this client + event. */
export function tikTokDuplicateExistingNames(
  original: Pick<TikTokCampaignDraft, "clientId" | "eventId">,
  visibleDrafts: readonly TikTokCampaignDraft[],
): string[] {
  return visibleDrafts
    .filter(
      (draft) =>
        draft.clientId === original.clientId &&
        draft.eventId === original.eventId,
    )
    .map((draft) => draft.campaignSetup.campaignName);
}

export function duplicateTikTokDraftState(
  original: TikTokCampaignDraft,
  newId: string,
  existingNames: readonly string[] = [],
): TikTokCampaignDraft {
  const copy = structuredClone(original);
  const now = new Date().toISOString();
  copy.id = newId;
  copy.status = "draft";
  copy.publishedIds = null;
  copy.reviewReadyAt = null;
  copy.campaignSetup.campaignName = nextDuplicateName(
    original.campaignSetup.campaignName.trim(),
    existingNames,
  );
  // Null only the start. Step 5 heals a missing start via
  // suggestFreshTikTokSchedule while keeping a still-valid end (the event
  // date). Nulling the end would silently rewrite it to start + 7 days.
  copy.budgetSchedule.scheduleStartAt = null;
  copy.budgetSchedule.adGroups = copy.budgetSchedule.adGroups.map((group) => ({
    ...group,
    startAt: null,
    endAt: null,
  }));
  copy.createdAt = now;
  copy.updatedAt = now;
  return copy;
}

export function startTikTokDraftFromTemplate(
  template: TikTokCampaignTemplate,
  draftId: string,
  targetClientId: string | null = null,
  targetEventId: string | null = null,
) {
  return applyTikTokTemplate(template, draftId, targetClientId, targetEventId);
}

export function tikTokLibraryTemplateFromDraft(
  draft: TikTokCampaignDraft,
  meta: Pick<TikTokCampaignTemplate, "id" | "name" | "description" | "tags">,
): TikTokCampaignTemplate {
  const now = new Date().toISOString();
  return {
    ...meta,
    snapshot: snapshotTikTokDraft(draft),
    createdAt: now,
    updatedAt: now,
  };
}
