import type { CampaignDraft } from "../../types.ts";

/**
 * Where a derived term came from. Meta is the authoring surface, so every
 * term traces back to something the operator actually built in the Meta
 * wizard (or to the event record the plan is scoped to).
 *
 * Custom audiences and lookalikes are deliberately absent: they are Meta-only
 * by nature (uploaded lists, pixel events, %-similarity seeds) and have no
 * TikTok/Google equivalent. They are never derived and never block.
 */
export type VocabularyOrigin =
  | "meta_page"
  | "meta_page_group"
  | "meta_interest"
  | "meta_interest_group"
  | "meta_campaign"
  | "event_name"
  | "event_artist"
  | "event_venue"
  | "event_genre"
  | "plan_cluster";

export interface VocabularyTerm {
  term: string;
  origin: VocabularyOrigin;
  /** Human-readable provenance, e.g. `Meta page group "Jamie Jones"`. */
  provenance: string;
}

export interface PlanEventVocabularyContext {
  name?: string | null;
  venueName?: string | null;
  genres?: string[] | null;
  artistNames?: string[] | null;
}

export interface ExtractVocabularyInput {
  /** The linked Meta draft. Null when no Meta draft has been prepared yet. */
  draft?: CampaignDraft | null;
  event?: PlanEventVocabularyContext | null;
  /**
   * The plan's legacy audience cluster. Used ONLY when there is no Meta
   * draft — once Meta exists it is the authoring surface, not the plan field.
   */
  fallbackCluster?: string | null;
}

/**
 * Placeholder names the adapters and wizard defaults write. Deriving TikTok
 * keywords for "Prospecting" would be noise dressed up as targeting.
 */
const PLACEHOLDER_TERMS = new Set(
  [
    "prospecting",
    "search",
    "plan campaign",
    "plan creative",
    "plan ad",
    "untitled",
    "untitled event",
    "new campaign",
    "selected pages lookalike",
    "similar pages",
    "default",
    "test",
  ].map((term) => term.toLowerCase()),
);

const MIN_TERM_LENGTH = 3;

/**
 * Origin priority when the same term is reachable from several places.
 * A real page name beats a group label the operator typed.
 */
const ORIGIN_RANK: Record<VocabularyOrigin, number> = {
  meta_page: 0,
  meta_interest: 1,
  meta_page_group: 2,
  meta_interest_group: 3,
  event_artist: 4,
  event_name: 5,
  event_venue: 6,
  event_genre: 7,
  meta_campaign: 8,
  plan_cluster: 9,
};

export function isUsableVocabularyTerm(raw: string | null | undefined): boolean {
  const term = raw?.trim() ?? "";
  if (term.length < MIN_TERM_LENGTH) return false;
  if (PLACEHOLDER_TERMS.has(term.toLowerCase())) return false;
  return /[a-z0-9]/i.test(term);
}

function push(
  out: VocabularyTerm[],
  term: string | null | undefined,
  origin: VocabularyOrigin,
  provenance: string,
): void {
  const trimmed = term?.trim() ?? "";
  if (!isUsableVocabularyTerm(trimmed)) return;
  out.push({ term: trimmed, origin, provenance });
}

/**
 * Extract the targeting vocabulary the Meta draft already expresses.
 *
 * This reads only what the draft actually persists. Facebook page display
 * names are NOT stored in the draft (only page ids), so real page names
 * appear here once Meta has resolved them onto engagement-audience statuses;
 * until then the operator's group label carries the artist name.
 */
export function extractMetaVocabulary(
  input: ExtractVocabularyInput,
): VocabularyTerm[] {
  const out: VocabularyTerm[] = [];
  const draft = input.draft ?? null;

  if (draft) {
    for (const group of draft.audiences?.pageGroups ?? []) {
      for (const status of group.engagementAudienceStatuses ?? []) {
        push(out, status.pageName, "meta_page", `Meta page "${status.pageName}"`);
      }
      push(
        out,
        group.name,
        "meta_page_group",
        `Meta page group "${group.name?.trim()}"`,
      );
    }

    for (const group of draft.audiences?.interestGroups ?? []) {
      for (const interest of group.interests ?? []) {
        push(
          out,
          interest.name,
          "meta_interest",
          `Meta interest "${interest.name?.trim()}"`,
        );
      }
      push(
        out,
        group.name,
        "meta_interest_group",
        `Meta interest group "${group.name?.trim()}"`,
      );
      push(
        out,
        group.clusterType,
        "meta_interest_group",
        `Meta interest cluster "${group.clusterType?.trim()}"`,
      );
    }

    push(
      out,
      draft.settings?.campaignName,
      "meta_campaign",
      `Meta campaign name "${draft.settings?.campaignName?.trim()}"`,
    );
  }

  const event = input.event ?? null;
  if (event) {
    for (const artist of event.artistNames ?? []) {
      push(out, artist, "event_artist", `Event artist "${artist?.trim()}"`);
    }
    push(out, event.name, "event_name", `Event "${event.name?.trim()}"`);
    push(out, event.venueName, "event_venue", `Venue "${event.venueName?.trim()}"`);
    for (const genre of event.genres ?? []) {
      push(out, genre, "event_genre", `Event genre "${genre?.trim()}"`);
    }
  }

  // Only a fallback: once a Meta draft exists it is the authoring surface.
  if (!draft) {
    push(
      out,
      input.fallbackCluster,
      "plan_cluster",
      `Plan audience cluster "${input.fallbackCluster?.trim()}" (no Meta draft yet)`,
    );
  }

  return dedupeVocabulary(out);
}

export function dedupeVocabulary(terms: VocabularyTerm[]): VocabularyTerm[] {
  const best = new Map<string, VocabularyTerm>();
  for (const term of terms) {
    const key = term.term.toLowerCase();
    const existing = best.get(key);
    if (!existing || ORIGIN_RANK[term.origin] < ORIGIN_RANK[existing.origin]) {
      best.set(key, term);
    }
  }
  return [...best.values()].sort(
    (a, b) => ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] || a.term.localeCompare(b.term),
  );
}

/** Highest-signal terms first, capped so one plan cannot fan out unbounded. */
export function topVocabularyTerms(
  terms: VocabularyTerm[],
  limit: number,
): VocabularyTerm[] {
  return dedupeVocabulary(terms).slice(0, Math.max(0, limit));
}
