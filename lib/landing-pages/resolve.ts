import type { LandingPageContext, LandingPageOutcome } from "./types";

/**
 * lib/landing-pages/resolve.ts
 *
 * Pure decision layer between getLandingPageContext() and the public route.
 * No IO — unit-tested directly (npm test has no HTTP harness).
 */

/**
 * Decide what the public /l route does with a resolved (or missing) context.
 *
 *   null context        → not found (page calls notFound())
 *   provider 'evntree'  → redirect to evntree_url
 *   'evntree' + no url  → misconfigured (page THROWS → 500; the DB CHECK
 *                         should make this unreachable, but loud-fail beats
 *                         a silent redirect to a blank target)
 *   provider 'internal' → render the placeholder
 */
export function resolveLandingPageOutcome(
  context: LandingPageContext | null,
): LandingPageOutcome | null {
  if (!context) return null;

  if (context.pageEvent.provider === "evntree") {
    const url = context.pageEvent.evntree_url;
    if (!url || url.trim() === "") {
      return {
        kind: "misconfigured",
        reason:
          `page_events row ${context.pageEvent.id} has provider='evntree' but ` +
          `no evntree_url. This should be impossible (DB CHECK ` +
          `page_events_evntree_url_required) — refusing to redirect to a ` +
          `blank target. Fix the row or flip provider to 'internal'.`,
      };
    }
    return { kind: "redirect", url };
  }

  return { kind: "render", context };
}
