/**
 * lib/google-search/final-url-state.ts
 *
 * Pure helpers for the RSA final-URL surface. Two consumers:
 *
 *   - Plan Setup's `Default final URL` input — shows the plan-level
 *     URL (the one shared by every RSA) or a hint when RSAs disagree.
 *   - Review step + push adapter — turn the per-RSA URLs into
 *     validation issues / blocked pushes.
 *
 * Centralising the logic keeps the URL validation (https vs http,
 * `https?://` prefix) consistent across the wizard, validator, and
 * push adapter.
 */

import type { GoogleSearchPlanTree, GoogleSearchRsa } from "./types.ts";

const URL_PREFIX = /^https?:\/\//i;

export interface PlanFinalUrlState {
  /** Single URL shared by every RSA, when one exists. */
  shared: string | null;
  /** True when at least one RSA has its own URL different from the shared. */
  mixed: boolean;
  /** Total RSAs whose `final_url` is null or empty (block push). */
  missingCount: number;
  /** Total RSAs whose `final_url` is set but not http(s):// (warn). */
  invalidCount: number;
  /** Total RSAs whose `final_url` uses http:// (soft warn for https). */
  httpCount: number;
  /** Total RSAs in the tree. */
  totalRsas: number;
}

export function collectPlanFinalUrlState(tree: GoogleSearchPlanTree): PlanFinalUrlState {
  let shared: string | null = null;
  let sharedInitialised = false;
  let mixed = false;
  let missingCount = 0;
  let invalidCount = 0;
  let httpCount = 0;
  let totalRsas = 0;

  for (const c of tree.campaigns) {
    for (const ag of c.ad_groups) {
      for (const rsa of ag.rsas) {
        totalRsas += 1;
        const url = (rsa.final_url ?? "").trim();
        if (!url) {
          missingCount += 1;
        } else if (!isValidLandingUrl(url)) {
          invalidCount += 1;
        } else if (/^http:\/\//i.test(url)) {
          httpCount += 1;
        }
        if (!sharedInitialised) {
          shared = url || null;
          sharedInitialised = true;
          continue;
        }
        if ((shared ?? "") !== url) {
          mixed = true;
        }
      }
    }
  }
  return {
    shared: mixed ? null : shared,
    mixed,
    missingCount,
    invalidCount,
    httpCount,
    totalRsas,
  };
}

export function isValidLandingUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  return URL_PREFIX.test(trimmed);
}

export function isPushableRsa(rsa: GoogleSearchRsa): boolean {
  const url = (rsa.final_url ?? "").trim();
  return isValidLandingUrl(url);
}

/**
 * Reason string surfaced to the operator for an RSA that can't be
 * pushed (push adapter's partial-failure bucket).
 */
export function finalUrlBlockReason(rsa: GoogleSearchRsa): string | null {
  const url = (rsa.final_url ?? "").trim();
  if (!url) {
    return "RSA has no final URL — Google Ads rejects RSAs without a landing page (skipped).";
  }
  if (!isValidLandingUrl(url)) {
    return `RSA final URL "${url}" is not a valid http(s) URL — skipped.`;
  }
  return null;
}
