import type { AudienceSubtype } from "@/lib/types/audience";

/** Bracketed event code from `[CODE] Rest of name` — first `[…]` wins. */
export function extractEventCode(campaignName: string): string | null {
  const m = campaignName.match(/\[([^\]]+)\]/);
  if (!m) return null;
  const inner = m[1]?.trim();
  return inner ? inner : null;
}

export interface MostCommonEventCodeResult {
  /** Most frequent non-null bracket code among campaign names. */
  code: string | null;
  /** Campaigns whose extracted code is not the winner (includes null codes). */
  otherCount: number;
}

/**
 * Picks the most common `[event_code]` among campaign names (non-null codes only).
 * Tie-break: lexicographically smallest code at max frequency.
 */
export function mostCommonEventCode(
  campaignNames: string[],
): MostCommonEventCodeResult {
  if (campaignNames.length === 0) {
    return { code: null, otherCount: 0 };
  }
  const extracted = campaignNames.map((n) => extractEventCode(n));
  const nonNull = extracted.filter((c): c is string => c != null);
  if (nonNull.length === 0) {
    return { code: null, otherCount: 0 };
  }
  const freq = new Map<string, number>();
  for (const c of nonNull) {
    freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  let max = -1;
  const leaders: string[] = [];
  for (const [code, count] of freq) {
    if (count > max) {
      max = count;
      leaders.length = 0;
      leaders.push(code);
    } else if (count === max) {
      leaders.push(code);
    }
  }
  leaders.sort();
  const winner = leaders[0]!;
  const otherCount = extracted.filter((c) => c !== winner).length;
  return { code: winner, otherCount };
}

export interface NamingClientContext {
  slug: string | null;
  name: string;
}

export interface NamingEventContext {
  eventCode: string | null;
  name: string;
}

export interface BuildAudienceNameOpts {
  scope: "client" | "event";
  client: NamingClientContext;
  /** When scope is event and an event row is selected. */
  event: NamingEventContext | null;
  subtype: AudienceSubtype;
  retentionDays: number;
  /** Video views threshold — defaults to 50. */
  threshold?: number;
  /**
   * Campaign display names for video views (e.g. from SourceSelection.campaignSummaries).
   * When non-empty, prefix comes from bracket codes in these names.
   */
  campaignNames?: string[];
}

function bracketToken(inner: string): string {
  return `[${inner}]`;
}

function basePrefixToken(opts: BuildAudienceNameOpts): string {
  if (opts.scope === "event" && opts.event) {
    return opts.event.eventCode?.trim() || opts.event.name.trim();
  }
  return opts.client.slug?.trim() || opts.client.name.trim();
}

function subtypeMiddlePhrase(subtype: AudienceSubtype, threshold: number): string {
  switch (subtype) {
    case "page_engagement_fb":
      return "FB page engagement";
    case "page_engagement_ig":
      return "IG page engagement";
    case "page_followers_fb":
      return "FB page followers";
    case "page_followers_ig":
      return "IG page followers";
    case "website_pixel":
      return "pixel";
    case "video_views":
      return `${threshold}% video views`;
    default: {
      const _exhaustive: never = subtype;
      return _exhaustive;
    }
  }
}

/**
 * Human-readable audience name for the Audience Builder UI.
 * Meta sanitization (underscores, etc.) happens at POST.
 */
export function buildAudienceName(opts: BuildAudienceNameOpts): string {
  const retention = Math.max(1, Math.min(365, Math.trunc(opts.retentionDays)));
  const threshold = opts.threshold ?? 50;

  let prefixInner: string;

  if (opts.subtype === "video_views") {
    const names = opts.campaignNames?.filter(Boolean) ?? [];
    if (names.length > 0) {
      const { code, otherCount } = mostCommonEventCode(names);
      if (code) {
        prefixInner =
          otherCount > 0 ? `${code}+${otherCount}` : code;
      } else {
        prefixInner = basePrefixToken(opts);
      }
    } else {
      prefixInner = basePrefixToken(opts);
    }
  } else {
    prefixInner = basePrefixToken(opts);
  }

  const middle = subtypeMiddlePhrase(opts.subtype, threshold);
  return `${bracketToken(prefixInner)} ${middle} ${retention}d`;
}
