/**
 * lib/wizard/lp-destination.ts
 *
 * Pure offer / fill / nudge rules for the wizard destination-URL fields.
 * Offer, never force: a URL the operator already typed is never overwritten
 * by auto-fill. A click on "Use event page" is explicit and may replace.
 */

export function normalizeDestinationUrl(raw: string): string {
  return raw.trim();
}

function tryParseHttpUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/** Same destination: ignore trailing slash and default ports; host is case-insensitive. */
export function destinationUrlsMatch(a: string, b: string): boolean {
  const left = tryParseHttpUrl(a);
  const right = tryParseHttpUrl(b);
  if (left && right) {
    const path = (p: string) => (p === "/" ? "" : p.replace(/\/+$/, ""));
    return (
      left.protocol === right.protocol &&
      left.hostname.toLowerCase() === right.hostname.toLowerCase() &&
      left.port === right.port &&
      path(left.pathname) === path(right.pathname)
    );
  }
  const na = normalizeDestinationUrl(a);
  const nb = normalizeDestinationUrl(b);
  if (!na || !nb) return false;
  return na.replace(/\/+$/, "") === nb.replace(/\/+$/, "");
}

/**
 * Auto-fill / post-create fill is allowed only when the field is empty
 * (or already the suggested LP). A typed-in other URL is never overwritten.
 */
export function canAutoFillDestinationUrl(
  current: string,
  suggested: string,
): boolean {
  const cur = normalizeDestinationUrl(current);
  if (!cur) return true;
  return destinationUrlsMatch(cur, suggested);
}

/**
 * Quiet off-funnel line: only when an LP exists, the field is non-empty,
 * and the chosen URL is not that LP. Empty is "not yet chosen", not off-funnel.
 */
export function shouldNudgeOffFunnel(input: {
  lpUrl: string | null;
  chosenUrl: string;
}): boolean {
  const lpUrl = input.lpUrl?.trim() || null;
  if (!lpUrl) return false;
  const chosen = normalizeDestinationUrl(input.chosenUrl);
  if (!chosen) return false;
  return !destinationUrlsMatch(chosen, lpUrl);
}

export const USE_EVENT_PAGE_WHY =
  "views and signups become measurable in your funnel.";

export const OFF_FUNNEL_NUDGE =
  "this campaign's views won't appear in the funnel";

export const DRAFT_NOT_OFFERED =
  "created as draft — publish before using as a destination.";

export const UNCONFIGURED_CLIENT =
  "this client has no landing-page config yet — create it before using the URL.";

export type DestinationHelperKind =
  | "why"
  | "nudge"
  | "draft"
  | "unconfigured"
  | "create";

/**
 * Exactly one helper line per state. Ready + off-funnel is the nudge;
 * ready + empty is the why. Never both.
 */
export function destinationHelperKind(input: {
  state: "ready" | "draft" | "unconfigured" | "none";
  offerUrl: boolean;
  lpUrl: string | null;
  chosenUrl: string;
}): DestinationHelperKind | null {
  if (input.state === "draft") return "draft";
  if (input.state === "unconfigured") return "unconfigured";
  if (input.state === "none") return "create";
  if (input.state === "ready") {
    if (shouldNudgeOffFunnel({ lpUrl: input.lpUrl, chosenUrl: input.chosenUrl })) {
      return "nudge";
    }
    if (input.offerUrl && input.lpUrl && input.chosenUrl.trim()) return null;
    if (input.offerUrl && input.lpUrl) return "why";
  }
  return null;
}

export function destinationHelperText(
  kind: DestinationHelperKind | null,
): string | null {
  switch (kind) {
    case "why":
    case "create":
      return USE_EVENT_PAGE_WHY;
    case "nudge":
      return OFF_FUNNEL_NUDGE;
    case "draft":
      return DRAFT_NOT_OFFERED;
    case "unconfigured":
      return UNCONFIGURED_CLIENT;
    default:
      return null;
  }
}
