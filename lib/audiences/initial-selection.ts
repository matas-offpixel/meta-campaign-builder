/**
 * The audience builder's single-audience start, from its URL
 * (/audiences/{clientId}/new?subtype=video_views&threshold=50&retention=30).
 * Unknown or missing values start the builder as it always has. Reading the
 * URL makes no Meta call: the source picker's own reads run when the
 * operator picks sources, as before.
 *
 * Pure. No `@/` imports, so node --test loads it.
 */

import type { AudienceSubtype } from "../types/audience.ts";

const SUBTYPES: readonly AudienceSubtype[] = [
  "page_engagement_fb",
  "page_engagement_ig",
  "page_followers_fb",
  "page_followers_ig",
  "video_views",
  "website_pixel",
  "lookalike",
];
const THRESHOLDS = [25, 50, 75, 95, 100] as const;

export interface InitialSelection {
  subtype?: AudienceSubtype;
  threshold?: (typeof THRESHOLDS)[number];
  retentionDays?: number;
}

export function initialSelectionFrom(sp: { subtype?: string; threshold?: string; retention?: string }): InitialSelection {
  const out: InitialSelection = {};
  if (sp.subtype && (SUBTYPES as readonly string[]).includes(sp.subtype)) out.subtype = sp.subtype as AudienceSubtype;
  const t = Number(sp.threshold);
  if ((THRESHOLDS as readonly number[]).includes(t)) out.threshold = t as InitialSelection["threshold"];
  const d = Number(sp.retention);
  if (Number.isInteger(d) && d >= 1 && d <= 365) out.retentionDays = d;
  return out;
}

/** The builder's URL for a start. */
export function audienceBuilderHref(clientId: string, start: InitialSelection): string {
  const q = new URLSearchParams();
  if (start.subtype) q.set("subtype", start.subtype);
  if (start.threshold != null) q.set("threshold", String(start.threshold));
  if (start.retentionDays != null) q.set("retention", String(start.retentionDays));
  const qs = q.toString();
  return `/audiences/${encodeURIComponent(clientId)}/new${qs ? `?${qs}` : ""}`;
}
