/**
 * MML wizard — the eight steps, the drawer deep link, and which account
 * a client has used most. No React. The page renders this; it does not
 * fork the Meta stepper.
 */

import type { PlanAdapterName } from "./types.ts";

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
    const settings = record(record(row.draftJson)?.settings);
    metaAccount.push({
      value: text(settings?.metaAdAccountId) ?? text(settings?.adAccountId),
      at: row.updatedAt,
    });
    metaPixel.push({
      value: text(settings?.metaPixelId) ?? text(settings?.pixelId),
      at: row.updatedAt,
    });
    metaPage.push({ value: text(settings?.metaPageId), at: row.updatedAt });
    metaIg.push({ value: text(settings?.metaIGAccountId), at: row.updatedAt });
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
  if (step === 1) return "Objective still lives on each channel's drawer.";
  if (step === 2) return "Optimisation still lives on the Meta drawer.";
  return "This still lives on the channel drawer.";
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
