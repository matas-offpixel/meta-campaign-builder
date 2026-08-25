import type { LandingPageProvider, PageEventStatus } from "./types.ts";

/**
 * lib/landing-pages/wizard-renderability.ts
 *
 * Wizard-facing contract for "may we fill this URL into a live ad?"
 * Read-only: wizards never create or publish pages.
 *
 * The public /l renderer 404s when (see resolveLandingPageContext +
 * resolveLandingPageOutcome):
 *   - unknown client slug
 *   - unknown event slug / event not under that client
 *   - no page_events row
 *   - page_events.status ≠ "live" (draft / archived), unless verified preview
 *
 * Missing client_landing_pages does NOT 404 today (theme falls to defaults,
 * pixel stays off). The wizard still requires the row before offering a
 * URL.
 *
 * "ready" is the only state whose URL may be filled.
 */

export type WizardLpState = "ready" | "draft" | "unconfigured" | "none";

export interface WizardLpAssessment {
  state: WizardLpState;
  /** True only when the public renderer will serve this URL to fans. */
  offerUrl: boolean;
}

export interface AssessWizardLandingPageInput {
  hasPage: boolean;
  pageStatus: PageEventStatus | null;
  hasClientConfig: boolean;
  provider: LandingPageProvider | null;
  clientSlug: string | null;
  eventSlug: string | null;
}

export function assessWizardLandingPage(
  input: AssessWizardLandingPageInput,
): WizardLpAssessment {
  if (!input.hasPage) {
    return { state: "none", offerUrl: false };
  }
  if (!input.hasClientConfig) {
    return { state: "unconfigured", offerUrl: false };
  }
  const slugsOk = Boolean(input.clientSlug?.trim() && input.eventSlug?.trim());
  const ready =
    input.pageStatus === "live" &&
    input.provider === "internal" &&
    slugsOk;
  if (ready) {
    return { state: "ready", offerUrl: true };
  }
  return { state: "draft", offerUrl: false };
}
