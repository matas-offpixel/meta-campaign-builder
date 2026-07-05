/**
 * lib/admin/dashboard-widgets.ts — pure logic for the admin dashboard-home
 * widgets (OP909 Sprint 2 PR 7). No IO — the page fetches, these decide.
 * node:test-able in isolation.
 */

// ─── Next presale ──────────────────────────────────────────────────────────────

export interface PresalePageLike {
  status: string;
  presaleAt: string | null;
  eventName: string;
  eventSlug: string;
}

export interface NextPresale {
  eventName: string;
  eventSlug: string;
  presaleAt: string;
}

/**
 * The soonest FUTURE presale among LIVE pages. Past/invalid presale dates and
 * non-live pages are ignored. Null when nothing qualifies.
 */
export function nextPresale(
  pages: PresalePageLike[],
  nowMs: number,
): NextPresale | null {
  let best: NextPresale | null = null;
  let bestMs = Infinity;
  for (const p of pages) {
    if (p.status !== "live" || !p.presaleAt) continue;
    const ms = Date.parse(p.presaleAt);
    if (Number.isNaN(ms) || ms <= nowMs) continue;
    if (ms < bestMs) {
      bestMs = ms;
      best = {
        eventName: p.eventName,
        eventSlug: p.eventSlug,
        presaleAt: p.presaleAt,
      };
    }
  }
  return best;
}

// ─── Pixel health banner ───────────────────────────────────────────────────────

export type PixelWarnLevel = "error" | "warning";

export interface PixelWarning {
  level: PixelWarnLevel;
  message: string;
}

/**
 * Config-completeness warning for the dashboard banner. There is no CAPI
 * delivery log to detect "silence" directly, so this flags the actionable
 * misconfigurations that stop Meta receiving a live page's conversions:
 * a missing pixel id (nothing tracked at all) or a missing CAPI token
 * (browser pixel only, no server-side backup). Silent when there are no live
 * pages or the pixel + CAPI are both configured.
 */
export function pixelWarning(input: {
  livePages: number;
  pixelId: string | null;
  capiTokenConfigured: boolean;
}): PixelWarning | null {
  if (input.livePages <= 0) return null;
  if (!input.pixelId || input.pixelId.trim().length === 0) {
    return {
      level: "error",
      message:
        "No Meta Pixel is configured — signups on your live landing pages aren't being tracked. Add it in Integrations → Meta Pixel.",
    };
  }
  if (!input.capiTokenConfigured) {
    return {
      level: "warning",
      message:
        "Conversions API token isn't set — server-side signup conversions aren't sent to Meta (browser pixel only). Add it in Integrations → Meta Pixel.",
    };
  }
  return null;
}
