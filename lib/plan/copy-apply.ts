/**
 * Apply ticked copy onto MML-owned creatives.
 *
 * A creative the operator made in a drawer, or one whose draft no longer
 * matches the fingerprint Send stored, is left as it is. After a write,
 * the caller re-stamps `sent_fingerprint` with the new draft fingerprint
 * so the next Send does not treat the write as a drawer edit.
 *
 * A launched Meta or TikTok channel is not written.
 * A pushed Google plan is not written. A headline or description the
 * operator set (anything other than the canvas seed, and anything pinned)
 * is left. Locations are not touched.
 */

import { creativeDraftFingerprint } from "./creative-intake-apply.ts";
import { planIntakeSend, type IntakeOwnedCreative, type IntakeSendAsset } from "./creative-intake.ts";
import {
  deriveGoogleNoiseNegatives,
  GOOGLE_NOISE_NEGATIVES,
  isDerivedGoogleNote,
  mergeDerivedGoogleKeywords,
  type DerivedGoogleKeyword,
} from "./derive/google.ts";
import { COPY_LIMITS, fitLimit, fitTikTok } from "./copy-limits.ts";
import type { AdCreativeDraft, CampaignDraft, CTAType } from "../types.ts";
import type { TikTokCampaignDraft, TikTokCreativeDraft } from "../types/tiktok-draft.ts";
import type { GoogleSearchPlanTree, RsaDescription, RsaHeadline } from "../google-search/types.ts";

export const META_COPY_LAUNCHED_NOTE =
  "This plan's Meta campaign is already launched — copy was left as it is.";
export const TIKTOK_COPY_LAUNCHED_NOTE =
  "This plan's TikTok campaign is already launched — copy was left as it is.";
export const GOOGLE_COPY_PUSHED_NOTE =
  "This Google Search plan is already pushed — copy was left as it is.";
export const DRAWER_COPY_NOTE = "Left a creative that was edited in the drawer.";

export interface CopySelection {
  metaPrimary: string[];
  metaHeadline: string;
  metaDescription: string;
  tiktok: string;
  googleHeadlines: string[];
  googleDescriptions: string[];
  /** Destination written when URL copy-across is on. */
  url: string;
  cta: CTAType;
}

export interface CopyAcross {
  caption: boolean;
  url: boolean;
  cta: boolean;
  headline: boolean;
  description: boolean;
}

export interface ApplyCopyInput {
  meta: CampaignDraft | null;
  tiktok: TikTokCampaignDraft | null;
  owned: readonly IntakeOwnedCreative[];
  selection: CopySelection;
  across: CopyAcross;
  metaLaunched: boolean;
  tiktokLaunched: boolean;
}

export interface ApplyCopyResult {
  meta: CampaignDraft | null;
  tiktok: TikTokCampaignDraft | null;
  /** Fingerprints to store on the groups that were written. */
  fingerprints: Array<{ key: string; creativeId: string; fingerprint: string }>;
  notes: string[];
  metaChanged: boolean;
  tiktokChanged: boolean;
}

function clampList(lines: readonly string[], maxLen: number, maxCount: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (out.length >= maxCount) break;
    const fitted = fitLimit(line, maxLen);
    if (fitted) out.push(fitted);
  }
  return out;
}

function writeMetaCreative(creative: AdCreativeDraft, selection: CopySelection, across: CopyAcross): AdCreativeDraft {
  const next: AdCreativeDraft = {
    ...creative,
    captions: creative.captions.map((row) => ({ ...row })),
  };
  if (across.caption && selection.metaPrimary.length > 0) {
    next.captions = selection.metaPrimary.map((text, index) => ({
      id: creative.captions[index]?.id ?? crypto.randomUUID(),
      text,
    }));
  }
  if (across.headline && selection.metaHeadline) next.headline = selection.metaHeadline;
  if (across.description && selection.metaDescription) next.description = selection.metaDescription;
  if (across.url && selection.url.trim()) next.destinationUrl = selection.url.trim();
  if (across.cta) next.cta = selection.cta;
  return next;
}

function isRoutedTikTok(item: TikTokCreativeDraft): boolean {
  return Boolean(item.derivedFrom?.startsWith("registry:"));
}

export function applyCopy(input: ApplyCopyInput): ApplyCopyResult {
  const notes: string[] = [];
  const selection: CopySelection = {
    ...input.selection,
    metaPrimary: clampList(input.selection.metaPrimary, 2000, COPY_LIMITS.metaPrimaryMax),
    metaHeadline: fitLimit(input.selection.metaHeadline, COPY_LIMITS.metaHeadline) ?? "",
    metaDescription: fitLimit(input.selection.metaDescription, COPY_LIMITS.metaDescription) ?? "",
    tiktok: fitTikTok(input.selection.tiktok) ?? "",
    googleHeadlines: clampList(input.selection.googleHeadlines, COPY_LIMITS.googleHeadline, COPY_LIMITS.googleHeadlineMax),
    googleDescriptions: clampList(
      input.selection.googleDescriptions,
      COPY_LIMITS.googleDescription,
      COPY_LIMITS.googleDescriptionMax,
    ),
  };

  let meta = input.meta;
  let metaChanged = false;
  const fingerprints: ApplyCopyResult["fingerprints"] = [];
  if (meta && input.metaLaunched) {
    notes.push(META_COPY_LAUNCHED_NOTE);
  } else if (meta) {
    const ownedById = new Map(
      input.owned.filter((row) => row.creativeId).map((row) => [row.creativeId, row]),
    );
    const creatives = meta.creatives.map((creative) => {
      const owned = ownedById.get(creative.id);
      if (!owned) return creative;
      const edited =
        owned.fingerprint != null &&
        owned.draftFingerprint != null &&
        owned.fingerprint !== owned.draftFingerprint;
      if (edited) {
        notes.push(DRAWER_COPY_NOTE);
        return creative;
      }
      const next = writeMetaCreative(creative, selection, input.across);
      const fingerprint = creativeDraftFingerprint(next);
      fingerprints.push({ key: owned.key, creativeId: next.id, fingerprint });
      if (fingerprint !== creativeDraftFingerprint(creative)) metaChanged = true;
      return next;
    });
    meta = { ...meta, creatives };
  }

  let tiktok = input.tiktok;
  let tiktokChanged = false;
  if (tiktok && input.tiktokLaunched) {
    notes.push(TIKTOK_COPY_LAUNCHED_NOTE);
  } else if (tiktok) {
    const items = tiktok.creatives.items.map((item) => {
      if (!isRoutedTikTok(item)) return item;
      const next = { ...item };
      if (input.across.caption && selection.tiktok) {
        next.adText = selection.tiktok;
        next.caption = selection.tiktok;
      }
      if (input.across.url && selection.url.trim()) next.landingPageUrl = selection.url.trim();
      if (input.across.cta) next.cta = selection.cta;
      if (next.adText !== item.adText || next.landingPageUrl !== item.landingPageUrl || next.cta !== item.cta) {
        tiktokChanged = true;
      }
      return next;
    });
    tiktok = { ...tiktok, creatives: { items } };
  }

  return {
    meta,
    tiktok,
    fingerprints,
    notes: [...new Set(notes)],
    metaChanged,
    tiktokChanged,
  };
}

function clip(text: string, max: number): string {
  const trimmed = text.trim() || "Event";
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

/** Headlines and descriptions `planToGoogleDraft` writes before anyone edits them. */
export function canvasSeedCopy(planName: string): { headlines: Set<string>; descriptions: Set<string> } {
  const name = planName.trim() || "Event";
  return {
    headlines: new Set([clip(name, 30), clip(`${name} tickets`, 30), "Get tickets"]),
    descriptions: new Set([clip(`Tickets for ${name}`, 90), "Official event tickets."]),
  };
}

function seeded(text: string, seeds: Set<string>, pinned: boolean): boolean {
  if (pinned) return false;
  const value = text.trim();
  return value.length === 0 || seeds.has(value);
}

/**
 * Write RSA lines into the first ad group. Operator text stays. Seed text
 * and empty slots are replaced. Extra lines are appended up to the limit.
 * Keywords and noise negatives are merged the way prepare-draft merges them.
 * `geo_targets` is copied through unchanged.
 */
export function applyCopyToGoogleTree(
  tree: GoogleSearchPlanTree,
  input: {
    headlines: readonly string[];
    descriptions: readonly string[];
    keywords: readonly DerivedGoogleKeyword[];
  },
): { tree: GoogleSearchPlanTree; changed: boolean; note: string | null } {
  if (tree.plan.pushed_at || tree.plan.status === "pushed" || tree.plan.status === "partially_pushed") {
    return { tree, changed: false, note: GOOGLE_COPY_PUSHED_NOTE };
  }
  const campaign = tree.campaigns[0];
  const adGroup = campaign?.ad_groups[0];
  const rsa = adGroup?.rsas[0];
  if (!campaign || !adGroup || !rsa) return { tree, changed: false, note: null };

  const seeds = canvasSeedCopy(tree.plan.name);
  const headlines = clampList(input.headlines, COPY_LIMITS.googleHeadline, COPY_LIMITS.googleHeadlineMax);
  const descriptions = clampList(input.descriptions, COPY_LIMITS.googleDescription, COPY_LIMITS.googleDescriptionMax);
  const nextHeadlines = mergeSlots(
    rsa.headlines,
    headlines,
    seeds.headlines,
    COPY_LIMITS.googleHeadlineMax,
  );
  const nextDescriptions = mergeSlots(
    rsa.descriptions,
    descriptions,
    seeds.descriptions,
    COPY_LIMITS.googleDescriptionMax,
  );

  const noise = [
    ...deriveGoogleNoiseNegatives(),
    ...["jobs", "lyrics"]
      .filter((keyword) => !(GOOGLE_NOISE_NEGATIVES as readonly string[]).includes(keyword))
      .map((keyword) => ({
        keyword,
        match_type: "PHRASE" as const,
        reason: derivedNoteFromJobs(keyword),
      })),
  ];
  const merged = mergeDerivedGoogleKeywords(
    {
      ...tree,
      campaigns: tree.campaigns.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              ad_groups: entry.ad_groups.map((group, groupIndex) =>
                groupIndex === 0
                  ? {
                      ...group,
                      rsas: group.rsas.map((row, rsaIndex) =>
                        rsaIndex === 0 ? { ...row, headlines: nextHeadlines, descriptions: nextDescriptions } : row,
                      ),
                    }
                  : group,
              ),
            }
          : entry,
      ),
    },
    [...input.keywords],
    noise,
  );
  const changed =
    JSON.stringify(merged.tree.campaigns[0]?.ad_groups[0]?.rsas[0]?.headlines) !== JSON.stringify(rsa.headlines) ||
    JSON.stringify(merged.tree.campaigns[0]?.ad_groups[0]?.rsas[0]?.descriptions) !== JSON.stringify(rsa.descriptions) ||
    merged.addedKeywords > 0 ||
    merged.addedNegatives > 0 ||
    merged.replacedDerivedKeywords > 0;
  return { tree: merged.tree, changed, note: null };
}

function derivedNoteFromJobs(keyword: string): string {
  return `plan-derived: ${keyword} (noise)`;
}

function mergeSlots<T extends RsaHeadline | RsaDescription>(
  current: readonly T[],
  incoming: readonly string[],
  seeds: Set<string>,
  max: number,
): T[] {
  const queue = [...incoming];
  const next: T[] = current.map((slot) => {
    const pinned = slot.pin_position != null && slot.pin_position !== undefined;
    if (!seeded(slot.text, seeds, Boolean(pinned)) || queue.length === 0) return slot;
    const text = queue.shift() ?? slot.text;
    return { ...slot, text };
  });
  while (queue.length > 0 && next.length < max) {
    next.push({ text: queue.shift() as string } as T);
  }
  return next;
}

export function googleTreeKeepsOperatorKeyword(tree: GoogleSearchPlanTree, keyword: string): boolean {
  const rows = tree.campaigns[0]?.ad_groups[0]?.keywords ?? [];
  return rows.some((row) => row.keyword.toLowerCase() === keyword.toLowerCase() && !isDerivedGoogleNote(row.notes));
}

/**
 * After Apply stamps the new fingerprint, Send sees no drawer edit and
 * no asset change, so it does not rewrite the creative.
 */
export function sendAfterApplyIsNoop(input: {
  assets: readonly IntakeSendAsset[];
  owned: IntakeOwnedCreative;
}): boolean {
  const plan = planIntakeSend({
    assets: input.assets,
    owned: [input.owned],
    routes: [],
    metaLaunched: false,
    tiktokLaunched: false,
  });
  const row = plan.meta.find((item) => item.creativeId === input.owned.creativeId);
  return row?.action === "noop" && !plan.notes.some((note) => /drawer/i.test(note));
}
