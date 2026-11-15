/**
 * MML wizard — the eight steps, the drawer deep link, and which account
 * a client has used most. No React. The page renders this; it does not
 * fork the Meta stepper.
 */

import type { PlanAdapterName, CampaignPlanObjectiveIntent } from "./types.ts";
import { mapIntentToTikTokObjective } from "./adapters/tiktok.ts";
import {
  TIKTOK_OBJECTIVES,
  TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE,
} from "../tiktok-wizard/campaign-setup.ts";
import type { TikTokObjective, TikTokOptimisationGoal } from "../types/tiktok-draft.ts";

export const MML_WIZARD_STEPS = [
  { label: "Client & channels", description: "Client, channels, identities" },
  { label: "Objective", description: "One objective for every channel" },
  { label: "Optimisation", description: "Account benchmarks" },
  { label: "Audiences", description: "Who sees the ads" },
  { label: "Creatives", description: "The ads" },
  { label: "Budget", description: "Budget and schedule" },
  { label: "Assign", description: "Which ad uses which creative" },
  { label: "Review", description: "Launch all, paused" },
] as const;

export type MmlWizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type MmlChannel = "meta" | "tiktok" | "google";

export const MML_STEP_QUERY = "step";
export const MML_CHANNEL_QUERY = "channel";

export interface MmlChannelSelection {
  meta: boolean;
  tiktok: boolean;
  google: boolean;
}

export interface MmlWizardLocation {
  step: MmlWizardStep;
  channel: MmlChannel;
}

const STEPS = new Set<number>([0, 1, 2, 3, 4, 5, 6, 7]);

export function isMmlWizardStep(value: number): value is MmlWizardStep {
  return STEPS.has(value);
}

/**
 * `?drawer=f|tt|g` opens the step that owns that tab, and selects the
 * channel pill. A bare drawer with no tab opens the first tab's step.
 */
export function mmlStepForDrawer(
  adapter: PlanAdapterName,
  tab: string | null,
): MmlWizardLocation {
  if (adapter === "meta") {
    if (tab === "f-creatives") return { step: 4, channel: "meta" };
    if (tab === "f-adsets") return { step: 6, channel: "meta" };
    return { step: 3, channel: "meta" };
  }
  if (adapter === "tiktok") {
    if (tab === "tt-refine") return { step: 3, channel: "tiktok" };
    return { step: 4, channel: "tiktok" };
  }
  if (tab === "g-copy") return { step: 4, channel: "google" };
  return { step: 3, channel: "google" };
}

export function readMmlWizardLocation(search: {
  get(key: string): string | null;
}): MmlWizardLocation {
  const drawer = search.get("drawer");
  const adapter =
    drawer === "f" ? "meta" : drawer === "tt" ? "tiktok" : drawer === "g" ? "google" : null;
  if (adapter) return mmlStepForDrawer(adapter, search.get("tab"));
  const raw = Number(search.get(MML_STEP_QUERY));
  const step = isMmlWizardStep(raw - 1) ? ((raw - 1) as MmlWizardStep) : 0;
  const channelRaw = search.get(MML_CHANNEL_QUERY);
  const channel: MmlChannel =
    channelRaw === "tiktok" || channelRaw === "google" ? channelRaw : "meta";
  return { step, channel };
}

/** Step numbers in the URL are 1–8, matching the stepper. */
export function mmlWizardHref(
  pathname: string,
  location: MmlWizardLocation,
  existing?: { toString(): string },
): string {
  const params = new URLSearchParams(existing ? existing.toString() : "");
  params.delete("drawer");
  params.delete("tab");
  params.set(MML_STEP_QUERY, String(location.step + 1));
  params.set(MML_CHANNEL_QUERY, location.channel);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function googleChannelAvailable(customerId: string | null | undefined): boolean {
  return Boolean(customerId?.trim());
}

/** A linked draft or a daily budget turns a channel on. Otherwise Meta. */
export function initialMmlChannels(input: {
  metaDraft: boolean;
  tiktokDraft: boolean;
  googleDraft: boolean;
  metaDaily: number;
  tiktokDaily: number;
  googleDaily: number;
  googleAvailable: boolean;
}): MmlChannelSelection {
  const meta = input.metaDraft || input.metaDaily > 0;
  const tiktok = input.tiktokDraft || input.tiktokDaily > 0;
  const google = input.googleAvailable && (input.googleDraft || input.googleDaily > 0);
  if (!meta && !tiktok && !google) return { meta: true, tiktok: false, google: false };
  return { meta, tiktok, google };
}

/**
 * The value used most often. A tie goes to the newest `at` (ISO strings
 * compare in time order).
 */
export function mostUsedId(
  rows: ReadonlyArray<{ value: string | null | undefined; at: string }>,
): string | null {
  const counts = new Map<string, { n: number; at: string }>();
  for (const row of rows) {
    const value = row.value?.trim() ?? "";
    if (!value) continue;
    const current = counts.get(value);
    if (!current) counts.set(value, { n: 1, at: row.at });
    else {
      current.n += 1;
      if (row.at > current.at) current.at = row.at;
    }
  }
  let best: { value: string; n: number; at: string } | null = null;
  for (const [value, stat] of counts) {
    if (!best || stat.n > best.n || (stat.n === best.n && stat.at > best.at)) {
      best = { value, n: stat.n, at: stat.at };
    }
  }
  return best?.value ?? null;
}

export interface ChannelHistoryPick {
  metaAdAccountId: string | null;
  metaPixelId: string | null;
  metaPageId: string | null;
  metaIgAccountId: string | null;
  tiktokAdvertiserId: string | null;
  tiktokIdentityId: string | null;
  googleAdsAccountId: string | null;
}

export const EMPTY_CHANNEL_HISTORY: ChannelHistoryPick = {
  metaAdAccountId: null,
  metaPixelId: null,
  metaPageId: null,
  metaIgAccountId: null,
  tiktokAdvertiserId: null,
  tiktokIdentityId: null,
  googleAdsAccountId: null,
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function summariseChannelHistory(input: {
  meta: ReadonlyArray<{ draftJson: unknown; updatedAt: string }>;
  tiktok: ReadonlyArray<{ state: unknown; updatedAt: string }>;
  google: ReadonlyArray<{ accountId: string | null; updatedAt: string }>;
}): ChannelHistoryPick {
  const metaAccount: Array<{ value: string | null; at: string }> = [];
  const metaPixel: Array<{ value: string | null; at: string }> = [];
  const metaPage: Array<{ value: string | null; at: string }> = [];
  const metaIg: Array<{ value: string | null; at: string }> = [];
  for (const row of input.meta) {
    const fields = metaFieldsFromDraft(row.draftJson);
    metaAccount.push({ value: fields.adAccountId, at: row.updatedAt });
    metaPixel.push({ value: fields.pixelId, at: row.updatedAt });
    metaPage.push({ value: fields.pageId, at: row.updatedAt });
    metaIg.push({ value: fields.igId, at: row.updatedAt });
  }
  const advertisers: Array<{ value: string | null; at: string }> = [];
  const identities: Array<{ value: string | null; at: string }> = [];
  for (const row of input.tiktok) {
    const account = record(record(row.state)?.accountSetup);
    advertisers.push({ value: text(account?.advertiserId), at: row.updatedAt });
    identities.push({ value: text(account?.identityId), at: row.updatedAt });
  }
  return {
    metaAdAccountId: mostUsedId(metaAccount),
    metaPixelId: mostUsedId(metaPixel),
    metaPageId: mostUsedId(metaPage),
    metaIgAccountId: mostUsedId(metaIg),
    tiktokAdvertiserId: mostUsedId(advertisers),
    tiktokIdentityId: mostUsedId(identities),
    googleAdsAccountId: mostUsedId(
      input.google.map((row) => ({ value: row.accountId, at: row.updatedAt })),
    ),
  };
}

/** A stored value wins. Otherwise history, then the client default. */
export function preferChannelValue(
  current: string | null | undefined,
  history: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  const stored = current?.trim() ?? "";
  if (stored) return stored;
  const used = history?.trim() ?? "";
  if (used) return used;
  const def = fallback?.trim() ?? "";
  return def || null;
}

export function mmlClientStepBlockers(input: {
  clientId: string | null;
  eventId: string | null;
  channels: MmlChannelSelection;
  metaAdAccountId: string | null;
  tiktokAdvertiserId: string | null;
  googleCustomerId: string | null;
}): string[] {
  const errors: string[] = [];
  if (!input.clientId) errors.push("Choose a client");
  if (!input.eventId) errors.push("Choose an event");
  if (!input.channels.meta && !input.channels.tiktok && !input.channels.google) {
    errors.push("Choose a channel");
  }
  if (input.channels.meta && !input.metaAdAccountId) errors.push("Ad account is required");
  if (input.channels.tiktok && !input.tiktokAdvertiserId) {
    errors.push("TikTok advertiser is required");
  }
  if (input.channels.google && !input.googleCustomerId) {
    errors.push("Google customer is required");
  }
  return errors;
}

/** Meta wizard step validated while this MML step is showing the Meta pill. */
export function metaValidateStepForMml(step: MmlWizardStep): 3 | 4 | 5 | 6 | null {
  if (step === 3 || step === 4 || step === 5 || step === 6) return step;
  return null;
}

export function mmlPlaceholderLine(step: MmlWizardStep): string {
  const lines: Partial<Record<MmlWizardStep, string>> = {};
  return lines[step] ?? "This still lives on the channel drawer.";
}

/**
 * Page, Instagram and TikTok show a name, or an initial when the picture
 * is missing. No name at all is "Unknown page (id)" — the tooltip carries
 * why the fetch failed.
 */
export function identityLabel(input: {
  id: string;
  name: string | null | undefined;
  noun: "page" | "Instagram account" | "TikTok identity" | "pixel";
}): { primary: string; unknown: boolean } {
  const name = input.name?.trim() ?? "";
  if (name) return { primary: name, unknown: false };
  if (input.noun === "page") return { primary: `Unknown page (${input.id})`, unknown: true };
  return { primary: `Unknown ${input.noun} (${input.id})`, unknown: true };
}

export function identityInitial(name: string): string {
  const ch = name.trim().charAt(0).toUpperCase();
  return ch || "?";
}

export function atUsername(username: string | null | undefined): string | null {
  const raw = username?.trim() ?? "";
  if (!raw) return null;
  return raw.startsWith("@") ? raw : `@${raw}`;
}

/**
 * Page and Instagram are on each creative's identity. `settings.pageId` is
 * empty on the Electric Brixton drafts; `settings.metaPageId` is only the
 * fallback when no creative has a page (it is often the client default).
 * Instagram prefers `identity.instagramActorId`, then `identity.instagramAccountId`.
 */
export function metaFieldsFromDraft(draftJson: unknown): {
  adAccountId: string | null;
  pixelId: string | null;
  pageId: string | null;
  igId: string | null;
} {
  const root = record(draftJson);
  const settings = record(root?.settings);
  const creatives = Array.isArray(root?.creatives) ? root.creatives : [];
  const pages: string[] = [];
  const igs: string[] = [];
  for (const creative of creatives) {
    const identity = record(record(creative)?.identity);
    const page = text(identity?.pageId);
    const ig = text(identity?.instagramActorId) ?? text(identity?.instagramAccountId);
    if (page) pages.push(page);
    if (ig) igs.push(ig);
  }
  return {
    adAccountId: text(settings?.metaAdAccountId) ?? text(settings?.adAccountId),
    pixelId: text(settings?.metaPixelId) ?? text(settings?.pixelId),
    pageId: mostCommon(pages) ?? text(settings?.metaPageId),
    igId: mostCommon(igs) ?? text(settings?.metaIGAccountId),
  };
}

function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: { value: string; n: number } | null = null;
  for (const [value, n] of counts) {
    if (!best || n > best.n) best = { value, n };
  }
  return best?.value ?? null;
}

export interface ChannelHistoryEntry {
  venueKey: string | null;
  eventId: string | null;
  /** `published` votes. Drafts vote only when the venue has no published launch. */
  status: string | null;
  updatedAt: string;
  metaAdAccountId: string | null;
  metaPixelId: string | null;
  metaPageId: string | null;
  metaIgAccountId: string | null;
  tiktokAdvertiserId: string | null;
  tiktokIdentityId: string | null;
  googleAdsAccountId: string | null;
}

export type ChannelPickSource = "event" | "venue" | "ad-account" | "client";

export const EVENT_LAST_LAUNCH_NOTE = "used on this event's last launch";

export interface ScopedPick {
  value: string | null;
  count: number;
  source: ChannelPickSource | null;
}

export interface ChannelFieldRow {
  value: string | null;
  at: string;
  venueKey: string | null;
  accountId: string | null;
  eventId?: string | null;
  status?: string | null;
}

/**
 * Published launches vote. A venue with none falls back to drafts.
 * One vote per event per value, so three drafts of one show are not three campaigns.
 * Rows with no event each keep their own vote.
 */
export function channelHistoryVotes(rows: readonly ChannelFieldRow[]): ChannelFieldRow[] {
  const explicit = rows.filter((row) => row.status != null);
  const pool =
    explicit.length === 0
      ? rows
      : (() => {
          const published = explicit.filter((row) => row.status === "published");
          return published.length > 0
            ? published
            : explicit.filter((row) => row.status === "draft");
        })();
  const best = new Map<string, ChannelFieldRow>();
  let anon = 0;
  for (const row of pool) {
    const value = row.value?.trim() ?? "";
    if (!value) continue;
    const eventKey = row.eventId?.trim() || `row:${anon++}`;
    const key = `${eventKey}\0${value}`;
    const prev = best.get(key);
    if (!prev || row.at > prev.at) best.set(key, row);
  }
  return [...best.values()];
}

/** The plan's own event: the page on its newest published launch, on this ad account. */
export function eventLastLaunch(input: {
  rows: readonly ChannelFieldRow[];
  eventId: string | null;
  accountId: string | null;
}): { value: string; at: string } | null {
  const eventId = input.eventId?.trim() ?? "";
  if (!eventId) return null;
  const account = input.accountId?.trim() ?? "";
  let best: { value: string; at: string } | null = null;
  for (const row of input.rows) {
    if ((row.eventId?.trim() ?? "") !== eventId) continue;
    if (row.status != null && row.status !== "published") continue;
    if (account && (row.accountId?.trim() ?? "") !== account) continue;
    const value = row.value?.trim() ?? "";
    if (!value) continue;
    if (!best || row.at > best.at) best = { value, at: row.at };
  }
  return best;
}

/** Venue, then the chosen account, then the whole client. Empty tiers are skipped. */
export function scopedMostUsed(input: {
  rows: readonly ChannelFieldRow[];
  venueKey: string | null;
  accountId: string | null;
}): ScopedPick {
  const venue = normalVenue(input.venueKey);
  const account = input.accountId?.trim() ?? "";
  if (venue) {
    const picked = pickTier(
      input.rows.filter((row) => {
        if (normalVenue(row.venueKey) !== venue) return false;
        if (!account) return true;
        return (row.accountId?.trim() ?? "") === account;
      }),
      "venue",
    );
    if (picked) return picked;
  }
  if (account) {
    const picked = pickTier(
      input.rows.filter((row) => (row.accountId?.trim() ?? "") === account),
      "ad-account",
    );
    if (picked) return picked;
  }
  return pickTier(input.rows, "client") ?? { value: null, count: 0, source: null };
}

function pickTier(rows: readonly ChannelFieldRow[], source: ChannelPickSource): ScopedPick | null {
  const voted = channelHistoryVotes(rows);
  const value = mostUsedId(voted.map((row) => ({ value: row.value, at: row.at })));
  if (!value) return null;
  const count = voted.filter((row) => (row.value?.trim() ?? "") === value).length;
  return { value, count, source };
}

export function normalVenue(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  return trimmed || null;
}

export function channelPickNote(pick: ScopedPick, venueLabel: string | null): string | null {
  if (!pick.value || !pick.source) return null;
  const noun = pick.count === 1 ? "campaign" : "campaigns";
  if (pick.source === "event") return EVENT_LAST_LAUNCH_NOTE;
  if (pick.source === "venue") {
    const venue = venueLabel?.trim() || "this venue";
    return `used on ${pick.count} ${venue} ${noun}`;
  }
  if (pick.source === "ad-account") return `used on ${pick.count} ${noun} on this ad account`;
  return `used on ${pick.count} ${noun} for this client`;
}

export interface ResolvedChannelFieldPick {
  value: string | null;
  flagged: string | null;
  note: string | null;
}

/**
 * Stored operator value, then venue / account / client history, then the
 * client default. A page that is not on the ad account's Page list is
 * returned as `flagged` and is not the selected value.
 * `accountPageIds === null` means the list is not ready, so nothing is flagged.
 */
export function resolveChannelField(input: {
  stored: string | null | undefined;
  storedFromDefault?: boolean;
  rows: readonly ChannelFieldRow[];
  venueKey: string | null;
  venueLabel: string | null;
  accountId: string | null;
  eventId?: string | null;
  clientDefault: string | null | undefined;
  accountPageIds?: readonly string[] | null;
}): ResolvedChannelFieldPick {
  const stored = input.stored?.trim() || null;
  const launch = eventLastLaunch({
    rows: input.rows,
    eventId: input.eventId ?? null,
    accountId: input.accountId,
  });
  const scoped = scopedMostUsed({
    rows: input.rows,
    venueKey: input.venueKey,
    accountId: input.accountId,
  });
  let candidate: string | null = null;
  let note: string | null = null;
  if (stored && !input.storedFromDefault) {
    candidate = stored;
    if (launch?.value === stored) note = EVENT_LAST_LAUNCH_NOTE;
    else if (scoped.value === stored) note = channelPickNote(scoped, input.venueLabel);
  } else if (launch) {
    candidate = launch.value;
    note = EVENT_LAST_LAUNCH_NOTE;
  } else if (scoped.value) {
    candidate = scoped.value;
    note = channelPickNote(scoped, input.venueLabel);
  } else if (input.clientDefault?.trim()) {
    candidate = input.clientDefault.trim();
    note = "client default";
  }
  const pages = input.accountPageIds;
  if (pages && candidate && !pages.includes(candidate)) {
    return { value: null, flagged: candidate, note };
  }
  return { value: candidate, flagged: null, note };
}

/** On sale is ticket sales. Every other phase starts as registration. */
export function eventObjectiveDefault(phase: string | null | undefined): {
  intent: "purchase" | "registration";
  cta: "book_now" | "sign_up";
} {
  if (phase === "on_sale") return { intent: "purchase", cta: "book_now" };
  return { intent: "registration", cta: "sign_up" };
}

export const MML_OBJECTIVE_CARDS: ReadonlyArray<{
  intent: "purchase" | "registration" | "traffic" | "awareness" | "engagement";
  label: string;
  sublabel: string;
}> = [
  { intent: "purchase", label: "Purchase", sublabel: "Sales → Purchase" },
  { intent: "registration", label: "Registration", sublabel: "Sales → CompleteRegistration" },
  { intent: "traffic", label: "Traffic", sublabel: "Landing Page Views" },
  { intent: "awareness", label: "Awareness", sublabel: "Reach" },
  { intent: "engagement", label: "Engagement", sublabel: "Boost an existing post" },
];

/** Null when the adapter's TikTok objective is not one the TikTok wizard offers. */
export function tikTokForPlanIntent(intent: CampaignPlanObjectiveIntent): {
  objective: TikTokObjective;
  goal: TikTokOptimisationGoal;
} | null {
  const objective = mapIntentToTikTokObjective(intent);
  if (!(TIKTOK_OBJECTIVES as readonly string[]).includes(objective)) return null;
  const goal = TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE[objective][0];
  if (!goal) return null;
  return { objective, goal };
}

/** Book now and Sign up follow the Meta CTA. Other mapped objectives use Learn more. */
export function tikTokCtaForPlanIntent(
  intent: CampaignPlanObjectiveIntent,
): "BOOK_NOW" | "SIGN_UP" | "LEARN_MORE" | null {
  if (intent === "purchase") return "BOOK_NOW";
  if (intent === "registration") return "SIGN_UP";
  if (intent === "traffic" || intent === "engagement") return "LEARN_MORE";
  return null;
}

/** TikTok ad text is 100 characters, cut on a word when the caption is longer. */
export function tikTokAdTextFromCaption(caption: string): string {
  const text = caption.trim().replace(/\s+/g, " ");
  if (text.length <= 100) return text;
  const slice = text.slice(0, 100);
  const space = slice.lastIndexOf(" ");
  return (space > 40 ? slice.slice(0, space) : slice).trimEnd();
}

const TIKTOK_COUNTRY_NAMES = new Set([
  "united kingdom",
  "ireland",
  "united states",
  "brazil",
  "germany",
  "france",
  "spain",
]);

/**
 * A country code or an empty list is not a regional audience. Nationwide
 * is the budget step. "GB" and the United Kingdom id are country-level.
 */
export function tikTokNeedsRegionalLocation(codes: readonly string[]): boolean {
  if (codes.length === 0) return true;
  return codes.every((code) => !/^\d+$/.test(code) || code === "2635167");
}

/** City token from a venue name: "NX Newcastle" → "newcastle". */
export function venueCityToken(venueName: string | null | undefined): string | null {
  const words = (venueName ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 2 && word !== "the" && word !== "nx");
  return words.at(-1) ?? null;
}

/**
 * A TikTok region around the venue, not the country. Nationwide is the
 * budget step's decision. The ids are the refine tab's region list.
 */
export function tikTokRegionalRegion(
  regions: readonly { id: string; name: string }[],
  venueName: string | null | undefined,
): { id: string; name: string } | null {
  const token = venueCityToken(venueName);
  if (!token) return null;
  const matches = regions.filter((region) => {
    const name = region.name.trim().toLowerCase();
    if (!name || TIKTOK_COUNTRY_NAMES.has(name)) return false;
    return name.includes(token);
  });
  matches.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
  return matches[0] ?? null;
}

/** One 9:16 video. Images, other ratios, and Dual/Full creatives stay on Meta. */
export function metaCreativeIsSingleVerticalVideo(creative: {
  mediaType?: string | null;
  assetMode?: string | null;
  sourceType?: string | null;
  assetVariations?: ReadonlyArray<{
    assets?: ReadonlyArray<{
      aspectRatio?: string | null;
      videoId?: string | null;
      assetHash?: string | null;
      fileName?: string | null;
      registryAssetId?: string | null;
    }>;
  }>;
}): boolean {
  if (creative.sourceType === "existing_post") return false;
  if (creative.assetMode === "dual" || creative.assetMode === "full") return false;
  if (creative.mediaType === "image") return false;
  const filled = (creative.assetVariations ?? []).flatMap((variation) =>
    (variation.assets ?? []).filter(
      (asset) =>
        Boolean(asset.videoId?.trim()) ||
        Boolean(asset.assetHash?.trim()) ||
        Boolean(asset.fileName?.trim()) ||
        Boolean(asset.registryAssetId?.trim()),
    ),
  );
  if (filled.length !== 1) return false;
  const asset = filled[0];
  return asset.aspectRatio === "9:16" && Boolean(asset.videoId?.trim() || creative.mediaType === "video");
}
