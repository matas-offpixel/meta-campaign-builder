/**
 * lib/bulk-attach/draft-state.ts
 *
 * Serialisation / deserialisation for the bulk-attach wizard state.
 *
 * Maps and Sets don't JSON-round-trip natively. This module provides a stable
 * serialisable shape (BulkAttachDraftState) and helpers to convert to/from the
 * live React state (Maps + Sets).
 *
 * The shape is stored in two places:
 *   - Supabase bulk_attach_drafts.state (server — explicit save)
 *   - localStorage bulk-attach-draft-{eventId}  (client — autosave)
 *
 * Both stores use the same JSON shape; deserialise handles both.
 */

import type { AdCreativeDraft, MetaCampaignSummary } from "@/lib/types";

export const DRAFT_STATE_VERSION = 1;

/** Stable JSON shape stored in Supabase / localStorage. */
export interface BulkAttachDraftState {
  /** Schema version — bump when the shape changes. */
  v: number;
  adAccountId: string;
  /** Current wizard step (0–3). Restored on resume so the user lands at their last position. */
  step: number;
  /** Map<campaignId, MetaCampaignSummary> serialised as an entry array. */
  selectedCampaigns: Array<[string, MetaCampaignSummary]>;
  /** Map<campaignId, Set<adSetId>> serialised as [campaignId, adSetId[]][]. */
  campaignAdSets: Array<[string, string[]]>;
  /** Wizard creative drafts — already JSON-serialisable (Asset.videoId etc. are strings). */
  creatives: AdCreativeDraft[];
}

/** Live React state shape used by the page component. */
export interface LiveBulkAttachState {
  adAccountId: string;
  step: number;
  selectedCampaigns: Map<string, MetaCampaignSummary>;
  campaignAdSets: Map<string, Set<string>>;
  creatives: AdCreativeDraft[];
}

// ─── Serialise ────────────────────────────────────────────────────────────────

export function serialiseDraftState(live: LiveBulkAttachState): BulkAttachDraftState {
  return {
    v: DRAFT_STATE_VERSION,
    adAccountId: live.adAccountId,
    step: live.step,
    selectedCampaigns: Array.from(live.selectedCampaigns.entries()),
    campaignAdSets: Array.from(live.campaignAdSets.entries()).map(([cid, set]) => [
      cid,
      Array.from(set),
    ]),
    creatives: live.creatives,
  };
}

// ─── Deserialise ──────────────────────────────────────────────────────────────

/**
 * Deserialise a raw JSON value from Supabase or localStorage.
 * Returns null if the value is invalid / incompatible.
 */
export function deserialiseDraftState(raw: unknown): LiveBulkAttachState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  // Tolerate missing v (pre-version drafts) but reject future major versions
  if (typeof obj.v === "number" && obj.v > DRAFT_STATE_VERSION) return null;

  try {
    const adAccountId = typeof obj.adAccountId === "string" ? obj.adAccountId : "";
    const step = typeof obj.step === "number" ? Math.max(0, Math.min(3, obj.step)) : 0;

    const selectedCampaigns = new Map<string, MetaCampaignSummary>(
      Array.isArray(obj.selectedCampaigns)
        ? (obj.selectedCampaigns as Array<[string, MetaCampaignSummary]>)
        : [],
    );

    const campaignAdSets = new Map<string, Set<string>>(
      Array.isArray(obj.campaignAdSets)
        ? (obj.campaignAdSets as Array<[string, string[]]>).map(([cid, ids]) => [
            cid,
            new Set(Array.isArray(ids) ? ids : []),
          ])
        : [],
    );

    const creatives: AdCreativeDraft[] = Array.isArray(obj.creatives)
      ? (obj.creatives as AdCreativeDraft[])
      : [];

    return { adAccountId, step, selectedCampaigns, campaignAdSets, creatives };
  } catch {
    return null;
  }
}

// ─── Meaningful-state guard ───────────────────────────────────────────────────

/**
 * Returns true when the state has enough content to be worth resuming.
 * Used by the "unsaved changes" banner to avoid prompting on a blank draft.
 */
export function hasMeaningfulState(state: LiveBulkAttachState): boolean {
  return (
    state.selectedCampaigns.size > 0 ||
    state.creatives.some((c) =>
      c.assetVariations?.some((v) => v.assets?.some((a) => a.uploadStatus === "uploaded")),
    )
  );
}

// ─── Default name generator ───────────────────────────────────────────────────

export function defaultDraftName(eventId?: string): string {
  const now = new Date();
  const day = now.getDate();
  const month = now.toLocaleString("en-GB", { month: "short" });
  const hour = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const suffix = eventId ? ` — ${eventId.slice(0, 8)}` : "";
  return `Bulk attach${suffix} ${day} ${month} ${hour}:${min}`;
}
