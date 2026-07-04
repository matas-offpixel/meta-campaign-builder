/**
 * lib/landing-pages/pixel-events.ts
 *
 * Pure, browser-safe helpers for the client-side Meta Pixel (PR 3). The
 * React components execute what these functions BUILD — keeping the
 * command construction pure is what makes the tenant-isolation tests able
 * to byte-diff pixel behaviour without a DOM.
 *
 * TRACKSINGLE INVARIANT (cross-tenant leak defence): `window.fbq` is a
 * window-global singleton. After a soft navigation between two tenants'
 * landing pages, BOTH pixels remain initialised in the same fbq instance —
 * a plain `fbq('track', …)` fires the event to EVERY initialised pixel,
 * i.e. tenant A's fans land in tenant B's retargeting pool. Every command
 * built here therefore uses `trackSingle` scoped to the one tenant pixel.
 * Never add a plain 'track' command — the isolation test greps for it.
 *
 * Event-id contract: one base uuid per browser session (sessionStorage, so
 * it survives the submit → success-state transition and reloads).
 *   PageView            event_id = `${base}-pv` (client-only in PR 3)
 *   CompleteRegistration event_id = `${base}-cr` (signup's Meta standard
 *   event — swapped from Lead post-PR-3; fired client-side AND sent in the
 *   signup POST body so the server CAPI event carries the SAME id — Meta
 *   dedups the pair on (event_name, event_id)).
 */

import type { StringStorage } from "./attribution.ts";

export type PixelCommand = readonly unknown[];

const EVENT_BASE_STORAGE_KEY = "lp_pixel_event_base_v1";

/** uuid v4 via crypto.randomUUID with a non-crypto fallback. */
function generateEventBase(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `lp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const EVENT_ID_RE = /^[A-Za-z0-9._:-]{8,64}$/;

/** Shared with the server-side schema — one charset, two enforcement points. */
export function isValidCapiEventId(value: string): boolean {
  return EVENT_ID_RE.test(value);
}

export function getOrCreateEventBase(storage: StringStorage): string {
  try {
    const existing = storage.getItem(EVENT_BASE_STORAGE_KEY);
    if (existing && isValidCapiEventId(`${existing}-pv`)) return existing;
    const fresh = generateEventBase();
    storage.setItem(EVENT_BASE_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Privacy mode / storage full — a non-persisted id still works, the
    // dedup pair just won't survive a reload.
    return generateEventBase();
  }
}

export function pageViewEventId(base: string): string {
  return `${base}-pv`;
}

export function completeRegistrationEventId(base: string): string {
  return `${base}-cr`;
}

/**
 * Commands the pixel loader runs on mount. ONLY the tenant pixel id ever
 * appears; PageView is trackSingle-scoped to it.
 */
export function buildPixelInitCommands(
  pixelId: string,
  pvEventId: string,
): PixelCommand[] {
  return [
    ["init", pixelId],
    ["trackSingle", pixelId, "PageView", {}, { eventID: pvEventId }],
  ];
}

/**
 * The CompleteRegistration command fired after a successful
 * (non-deduplicated) signup. Meta's standard event for account/newsletter
 * signups — pairs with Purchase in the funnel (signup → presale → ticket
 * buy). See design doc §12 + landmine 16: do not drift this back to Lead,
 * and future conversion events must use their own exact Meta name.
 */
export function buildCompleteRegistrationCommand(
  pixelId: string,
  eventId: string,
): PixelCommand {
  return ["trackSingle", pixelId, "CompleteRegistration", {}, { eventID: eventId }];
}

interface FbqWindow {
  fbq?: (...args: unknown[]) => void;
}

/** Execute a built command against window.fbq (no-op when absent). */
export function runPixelCommand(command: PixelCommand): void {
  if (typeof window === "undefined") return;
  const fbq = (window as unknown as FbqWindow).fbq;
  if (typeof fbq !== "function") return;
  try {
    fbq(...(command as unknown[]));
  } catch {
    // Pixel failures must never break the page.
  }
}
