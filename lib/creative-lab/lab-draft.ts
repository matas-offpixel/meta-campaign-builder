/**
 * The in-memory CampaignDraft a Lab round hands to the Meta launch route.
 *
 * The Lab does not write campaign_drafts. The launch route saves the row
 * itself, as published, under the round id. creativeIntegrityMode stays
 * unset so the route's default (on) opts out of text translation.
 *
 * createPaused: true lives only in buildLabLaunchBody.
 */

import { createDefaultDraft, createDefaultOptimisationStrategy } from "../campaign-defaults.ts";
import {
  attachedAdSetKey,
  type AdCreativeDraft,
  type CampaignDraft,
  type CTAType,
  type CreativeEnhancementSettings,
} from "../types.ts";

const ENHANCEMENTS_OFF: CreativeEnhancementSettings = {
  enabled: false,
  textOptimizations: false,
  visualEnhancements: false,
  musicEnhancements: false,
  autoVariations: false,
};

export type LabDraftTarget = {
  roundId: string;
  eventId: string;
  clientId: string | null;
  campaignName: string;
  adAccountId: string;
  campaignId: string;
  campaignObjective: string;
  adSetId: string;
  adSetName: string;
  adSetStatus: string;
  destinationUrl: string;
  cta: string;
};

export type LabDraftAd = {
  id: string;
  adName: string;
  primaryText: string;
  videoId: string;
  registryAssetId: string;
  pageId: string;
  instagramActorId: string | null;
};

const CTA_VALUES: readonly CTAType[] = ["sign_up", "learn_more", "book_now", "buy_tickets"];

export function labCta(value: string): CTAType {
  const key = value.trim().toLowerCase().replace(/\s+/g, "_");
  if ((CTA_VALUES as readonly string[]).includes(key)) return key as CTAType;
  if (key === "sign_up" || key === "signup") return "sign_up";
  if (key === "book_travel") return "book_now";
  return "learn_more";
}

export function buildLabDraft(target: LabDraftTarget, ads: readonly LabDraftAd[], now = new Date()): CampaignDraft {
  const base = createDefaultDraft();
  const settings = { ...base.settings };
  delete settings.creativeIntegrityMode;
  const capturedAt = now.toISOString();
  const creatives: AdCreativeDraft[] = ads.map((ad) => ({
    id: ad.id,
    name: ad.adName,
    sourceType: "new",
    identity: {
      pageId: ad.pageId,
      instagramAccountId: ad.instagramActorId ?? "",
      ...(ad.instagramActorId ? { instagramActorId: ad.instagramActorId } : {}),
    },
    mediaType: "video",
    assetMode: "single",
    assetVariations: [
      {
        id: `${ad.id}-variation`,
        name: ad.adName,
        assets: [
          {
            id: `${ad.id}-asset`,
            aspectRatio: "9:16",
            videoId: ad.videoId,
            registryAssetId: ad.registryAssetId,
            uploadStatus: "uploaded",
          },
        ],
      },
    ],
    captions: [{ id: `${ad.id}-caption`, text: ad.primaryText }],
    headline: "",
    description: "",
    destinationUrl: target.destinationUrl,
    cta: labCta(target.cta),
    enhancements: { ...ENHANCEMENTS_OFF },
  }));

  return {
    ...base,
    id: target.roundId,
    settings: {
      ...settings,
      clientId: target.clientId ?? "",
      eventId: target.eventId,
      adAccountId: target.adAccountId,
      metaAdAccountId: target.adAccountId,
      campaignCode: "",
      campaignName: target.campaignName,
      objective: "purchase",
      wizardMode: "attach_adset",
      existingMetaCampaign: {
        id: target.campaignId,
        name: target.campaignName,
        objective: target.campaignObjective,
        status: "ACTIVE",
        capturedAt,
      },
      existingMetaCampaigns: [
        {
          id: target.campaignId,
          name: target.campaignName,
          objective: target.campaignObjective,
          status: "ACTIVE",
          capturedAt,
        },
      ],
      existingMetaAdSets: [
        {
          id: target.adSetId,
          name: target.adSetName,
          campaignId: target.campaignId,
          status: target.adSetStatus || "ACTIVE",
          capturedAt,
        },
      ],
    },
    audiences: base.audiences,
    creatives,
    optimisationStrategy: createDefaultOptimisationStrategy(),
    budgetSchedule: base.budgetSchedule,
    adSetSuggestions: [],
    creativeAssignments: {
      [attachedAdSetKey(target.adSetId)]: creatives.map((creative) => creative.id),
    },
    status: "draft",
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}

/** The only place a Lab launch says paused. */
export function buildLabLaunchBody(draft: CampaignDraft) {
  return { draft, createPaused: true as const };
}
