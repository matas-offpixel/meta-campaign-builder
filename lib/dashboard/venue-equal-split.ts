/**
 * Pure helpers for non-WC26 venue spend: equal split across fixtures sharing
 * an `event_code`, and WC26 detection for the opponent-based allocator path.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sanitiseSpend(spend: number | null | undefined): number {
  if (spend == null || !Number.isFinite(spend) || spend < 0) return 0;
  return spend;
}

/** WC26 venues use opponent-matching + Meta ad-level allocation (PR #120). */
export function isWc26OpponentAllocatorEventCode(eventCode: string): boolean {
  return eventCode.trim().toUpperCase().startsWith("WC26-");
}

/**
 * KOC uses fixture-level event_codes (WC26-KOC-BRIXTON-ENG-CRO) but
 * Meta campaigns are tagged at venue level ([WC26-KOC-BRIXTON]).
 * 5+ dash-separated parts = fixture code that needs prefix stripping.
 */
export function isKocVenueFixtureCode(code: string): boolean {
  const up = code.trim().toUpperCase();
  return up.startsWith("WC26-KOC-") && up.split("-").length >= 5;
}

/** WC26-KOC-BRIXTON-ENG-CRO → WC26-KOC-BRIXTON */
export function extractKocVenuePrefix(code: string): string {
  return code.trim().toUpperCase().split("-").slice(0, 3).join("-");
}

/** Split venue-level pounds across `n` fixtures; last index absorbs rounding drift. */
export function equalSplitMonetaryAmounts(total: number, n: number): number[] {
  const t = round2(sanitiseSpend(total));
  if (n <= 0) return [];
  if (n === 1) return [t];
  const per = round2(t / n);
  const out: number[] = [];
  let remaining = t;
  for (let i = 0; i < n - 1; i++) {
    out.push(per);
    remaining = round2(remaining - per);
  }
  out.push(Math.max(0, round2(remaining)));
  return out;
}
