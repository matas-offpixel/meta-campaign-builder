import type { LandingPageProvider, PageEventStatus } from "./types.ts";

/**
 * lib/landing-pages/wizard-renderability.ts
 *
 * Wizard-facing contract for "may we fill this URL into a live ad?"
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
 * URL: B.1 handed out a path that could not render, and a client with no
 * config layer is the other half of that failure. Quick-create inserts
 * the row with theme defaults and no pixel/CAPI.
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

export interface RenderableEnsurePlan {
  createClientConfig: boolean;
  createPage: boolean;
  publishPage: boolean;
}

/** Theme defaults only. Pixel / CAPI stay unset (LP no-fallback rule). */
export const MINIMAL_CLIENT_LANDING_PAGE = {
  theme: {} as Record<string, unknown>,
  default_provider: "internal" as const,
};

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

/**
 * Writes needed to make a wizard-owned page publicly serveable.
 * Never unarchives. Never flips evntree → internal.
 */
export function planRenderableEnsure(input: {
  hasClientConfig: boolean;
  page: { status: PageEventStatus; provider: LandingPageProvider } | null;
}): RenderableEnsurePlan {
  const createClientConfig = !input.hasClientConfig;
  if (!input.page) {
    return { createClientConfig, createPage: true, publishPage: false };
  }
  const publishPage =
    input.page.provider === "internal" && input.page.status === "draft";
  return { createClientConfig, createPage: false, publishPage };
}
