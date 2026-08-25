/**
 * lib/wizard/lp-destination.ts
 *
 * Pure offer / fill / nudge rules for the wizard destination-URL fields.
 *
 * Wizards consume destination URLs; they do not create landing pages.
 * Paste-any-URL is the default. "Use event page" is offered only when GET
 * returns ready (a page the public renderer will serve). Draft /
 * unconfigured / none show nothing — page creation lives in the LP product.
 *
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

export type DestinationHelperKind = "why" | "nudge";

export type WizardLpOfferState = "ready" | "draft" | "unconfigured" | "none";

/**
 * Exactly one helper line, and only when a ready page is on offer.
 * Ready + off-funnel is the nudge; ready + empty is the why. Never both.
 * Draft / unconfigured / none: no helper (no create nudge).
 */
export function destinationHelperKind(input: {
  state: WizardLpOfferState;
  offerUrl: boolean;
  lpUrl: string | null;
  chosenUrl: string;
}): DestinationHelperKind | null {
  if (input.state !== "ready" || !input.offerUrl || !input.lpUrl) return null;
  if (shouldNudgeOffFunnel({ lpUrl: input.lpUrl, chosenUrl: input.chosenUrl })) {
    return "nudge";
  }
  if (input.chosenUrl.trim()) return null;
  return "why";
}

export function destinationHelperText(
  kind: DestinationHelperKind | null,
): string | null {
  switch (kind) {
    case "why":
      return USE_EVENT_PAGE_WHY;
    case "nudge":
      return OFF_FUNNEL_NUDGE;
    default:
      return null;
  }
}

/** What EventPageDestination may render. Create/publish are never in this set. */
export function wizardDestinationChrome(input: {
  state: WizardLpOfferState;
  offerUrl: boolean;
  lpUrl: string | null;
  chosenUrl: string;
}): { action: "use" | null; helper: DestinationHelperKind | null } {
  const helper = destinationHelperKind(input);
  if (input.state !== "ready" || !input.offerUrl || !input.lpUrl) {
    return { action: null, helper: null };
  }
  const alreadyUsing = destinationUrlsMatch(input.chosenUrl, input.lpUrl);
  return { action: alreadyUsing ? null : "use", helper };
}

/**
 * Strings that must not appear in EventPageDestination. A test greps them
 * out; it fails against the #843 component that still offered create/publish.
 */
export const WIZARD_CREATE_AFFORDANCE_BANS = [
  "Create event page",
  "Publish event page",
  "Creating event page",
  "Publishing event page",
  "create it before using",
  "created as draft",
] as const;
