import {
  applyPreset,
  PLAN_BUDGET_PRESETS,
  selectionFromBudget,
  type PlanBudgetPresetId,
} from "./budget-split.ts";
import { createEmptyCampaignPlan } from "./empty-plan.ts";
import {
  resolveEventEndAnchors,
  type EventEndAnchorId,
  type EventEndDateSource,
} from "./event-end-dates.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan, type CampaignPlanStatus } from "./types.ts";

export type PlanLibraryChromeTab = "drafts" | "published" | "archived" | "templates";

/**
 * Identity keys that must never survive a template snapshot or a
 * cross-client duplicate. Plans do not store these today; the list is
 * the pin so a later author cannot sneak a client binding onto the shape.
 */
export const PLAN_SHAPE_IDENTITY_KEYS = [
  "adAccountId",
  "metaAdAccountId",
  "pixelId",
  "metaPixelId",
  "metaPageId",
  "metaIGAccountId",
  "instagramActorId",
  "instagramAccountId",
  "advertiserId",
  "tiktokAccountId",
  "tiktokAdvertiserId",
  "identityId",
  "identityType",
  "identityBcId",
  "googleAdsAccountId",
  "googleAdsCustomerId",
  "google_ads_account_id",
  "clientId",
  "draftId",
  "platformCampaignId",
] as const;

export type PlanLibraryTab = Exclude<PlanLibraryChromeTab, "templates">;

export type PlanDestinationPattern = "ticket_url" | "signup_url";

export interface PlanTemplateEventSource extends EventEndDateSource {
  ticketUrl?: string | null;
  signupUrl?: string | null;
}

export interface CampaignPlanTemplateSnapshot {
  objectiveIntent: CampaignPlan["intent"]["objectiveIntent"];
  budget: CampaignPlan["intent"]["budget"];
  budgetMode: "daily" | "lifetime";
  splitPreset: PlanBudgetPresetId | null;
  startOffsetDays: number | null;
  endAnchor: EventEndAnchorId | null;
  endOffsetDays: number | null;
  startTime: string | null;
  endTime: string | null;
  destinationPattern: PlanDestinationPattern | null;
  audienceClusterRef: string | null;
  creativeSetRef: string | null;
}

export interface CampaignPlanTemplate {
  id: string;
  userId: string;
  name: string;
  description: string;
  tags: string[];
  snapshot: CampaignPlanTemplateSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface PlanLibraryItem {
  id: string;
  name: string | null;
  status: CampaignPlanStatus;
  eventId: string;
  eventName: string | null;
  thumbUrl: string | null;
  objectiveIntent: CampaignPlan["intent"]["objectiveIntent"] | null;
  totalDaily: number;
  startDate: string | null;
  endDate: string | null;
  launches: CampaignPlan["launches"];
  updatedAt: string;
}

export function planLibraryTab(status: CampaignPlanStatus): PlanLibraryTab {
  if (status === "archived") return "archived";
  if (status === "live" || status === "live_partial") return "published";
  return "drafts";
}

export function filterLibraryPlans<T extends { status: CampaignPlanStatus; name?: string | null; eventName?: string | null; objectiveIntent?: string | null }>(
  plans: T[],
  tab: PlanLibraryTab,
  search: string,
): T[] {
  let items = plans.filter((plan) => planLibraryTab(plan.status) === tab);
  if (search.trim()) {
    const q = search.toLowerCase();
    items = items.filter((plan) => {
      const name = (plan.name ?? "").toLowerCase();
      const eventName = (plan.eventName ?? "").toLowerCase();
      const objective = (plan.objectiveIntent ?? "").toLowerCase();
      return name.includes(q) || eventName.includes(q) || objective.includes(q);
    });
  }
  return items;
}

export function countPlanLibraryTabs(
  plans: Array<{ status: CampaignPlanStatus }>,
  templateCount: number,
): Record<PlanLibraryChromeTab, number> {
  return {
    drafts: plans.filter((plan) => planLibraryTab(plan.status) === "drafts").length,
    published: plans.filter((plan) => planLibraryTab(plan.status) === "published").length,
    archived: plans.filter((plan) => planLibraryTab(plan.status) === "archived").length,
    templates: templateCount,
  };
}

export function inferPlanSplitPreset(
  budget: CampaignPlan["intent"]["budget"],
): PlanBudgetPresetId | null {
  const selected = selectionFromBudget(budget);
  for (const preset of PLAN_BUDGET_PRESETS) {
    const applied = applyPreset(budget.totalDaily, preset.id, selected);
    if (
      applied.metaDaily === budget.metaDaily &&
      applied.tiktokDaily === budget.tiktokDaily &&
      applied.googleDaily === budget.googleDaily
    ) {
      return preset.id;
    }
  }
  return null;
}

export function inferDestinationPattern(
  destinationUrl: string,
  event: PlanTemplateEventSource | null | undefined,
): PlanDestinationPattern | null {
  const url = destinationUrl.trim();
  if (!url || !event) return null;
  if (event.ticketUrl?.trim() && urlsMatch(url, event.ticketUrl)) return "ticket_url";
  if (event.signupUrl?.trim() && urlsMatch(url, event.signupUrl)) return "signup_url";
  return null;
}

function urlsMatch(a: string, b: string): boolean {
  return a.replace(/\/$/, "") === b.trim().replace(/\/$/, "");
}

export function dayOffset(from: string | null | undefined, to: string | null | undefined): number | null {
  const start = ymd(from);
  const end = ymd(to);
  if (!start || !end) return null;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

export function addUtcDays(date: string, days: number): string {
  const base = Date.parse(`${ymd(date)}T00:00:00Z`);
  const next = new Date(base + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

function ymd(value: string | null | undefined): string | null {
  if (!value) return null;
  const slice = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(slice) ? slice : null;
}

export function extractPlanTemplateSnapshot(
  plan: CampaignPlan,
  event: PlanTemplateEventSource | null | undefined,
): CampaignPlanTemplateSnapshot {
  const eventDate = ymd(event?.eventDate);
  const start = ymd(plan.intent.startDate);
  const end = ymd(plan.intent.endDate);
  const anchors = resolveEventEndAnchors(event);
  const matchingAnchor = anchors.find((anchor) => anchor.date === end);
  return {
    objectiveIntent: plan.intent.objectiveIntent,
    budget: { ...plan.intent.budget },
    budgetMode: "daily",
    splitPreset: inferPlanSplitPreset(plan.intent.budget),
    startOffsetDays: eventDate && start ? dayOffset(eventDate, start) : null,
    endAnchor: matchingAnchor?.id ?? null,
    endOffsetDays: matchingAnchor || !eventDate || !end ? null : dayOffset(eventDate, end),
    startTime: plan.intent.startTime,
    endTime: plan.intent.endTime,
    destinationPattern: inferDestinationPattern(plan.intent.destinationUrl, event),
    audienceClusterRef: plan.intent.audienceClusterRef,
    creativeSetRef: plan.intent.creativeSetRef,
  };
}

export function snapshotHasAbsoluteDates(snapshot: CampaignPlanTemplateSnapshot): boolean {
  const bag = snapshot as unknown as Record<string, unknown>;
  return (
    typeof bag.startDate === "string" ||
    typeof bag.endDate === "string" ||
    typeof bag.eventId === "string"
  );
}

export function collectIdentityFields(value: unknown, found: string[] = []): string[] {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) collectIdentityFields(item, found);
    return found;
  }
  for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
    if (
      (PLAN_SHAPE_IDENTITY_KEYS as readonly string[]).includes(key) &&
      next != null &&
      next !== ""
    ) {
      found.push(key);
    }
    collectIdentityFields(next, found);
  }
  return found;
}

export function applyPlanTemplateSnapshot(
  snapshot: CampaignPlanTemplateSnapshot,
  input: {
    userId: string;
    eventId: string;
    event?: PlanTemplateEventSource | null;
    name?: string | null;
  },
): CampaignPlan {
  const plan = createEmptyCampaignPlan({
    userId: input.userId,
    eventId: input.eventId,
    name: input.name ?? undefined,
  });
  const eventDate = ymd(input.event?.eventDate);
  const anchors = resolveEventEndAnchors(input.event);
  const endFromAnchor = snapshot.endAnchor
    ? anchors.find((anchor) => anchor.id === snapshot.endAnchor)?.date ?? null
    : null;
  plan.intent.objectiveIntent = snapshot.objectiveIntent;
  plan.intent.budget = { ...snapshot.budget };
  plan.intent.startTime = snapshot.startTime;
  plan.intent.endTime = snapshot.endTime;
  plan.intent.audienceClusterRef = snapshot.audienceClusterRef;
  plan.intent.creativeSetRef = snapshot.creativeSetRef;
  plan.intent.startDate =
    eventDate != null && snapshot.startOffsetDays != null
      ? addUtcDays(eventDate, snapshot.startOffsetDays)
      : null;
  plan.intent.endDate =
    endFromAnchor ??
    (eventDate != null && snapshot.endOffsetDays != null
      ? addUtcDays(eventDate, snapshot.endOffsetDays)
      : null);
  plan.intent.destinationUrl = resolveDestinationFromPattern(
    snapshot.destinationPattern,
    input.event,
  );
  plan.status = "draft";
  plan.launches = {
    meta: { ...IDLE_PLAN_LAUNCH },
    tiktok: { ...IDLE_PLAN_LAUNCH },
    google: { ...IDLE_PLAN_LAUNCH },
  };
  return plan;
}

function resolveDestinationFromPattern(
  pattern: PlanDestinationPattern | null,
  event: PlanTemplateEventSource | null | undefined,
): string {
  if (pattern === "ticket_url") return event?.ticketUrl?.trim() || "";
  if (pattern === "signup_url") return event?.signupUrl?.trim() || "";
  return "";
}

export function duplicatePlanAsDraft(
  source: CampaignPlan,
  input: {
    userId: string;
    eventId: string;
    sourceEvent?: PlanTemplateEventSource | null;
    event?: PlanTemplateEventSource | null;
    name?: string | null;
  },
): CampaignPlan {
  const snapshot = extractPlanTemplateSnapshot(source, input.sourceEvent ?? null);
  return applyPlanTemplateSnapshot(snapshot, {
    userId: input.userId,
    eventId: input.eventId,
    event: input.event,
    name: input.name ?? source.name,
  });
}
