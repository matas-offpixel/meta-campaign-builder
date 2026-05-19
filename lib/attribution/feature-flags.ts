/**
 * lib/attribution/feature-flags.ts
 *
 * Three flags drive the dark-build state of PR #423:
 *
 *   `OFFPIXEL_REAL_ATTRIBUTION_ENABLED`
 *     When `"1"`, the new `RealAttributionTile` renders + the
 *     campaigns-aggregator swaps the spend-share `Sales (est.)`
 *     column for the verified-matches column. Default: off.
 *
 *   `OFFPIXEL_LEGACY_ATTRIBUTION_TILE`
 *     Kill-switch for PR #422's `AttributionGapTile`. Default off
 *     in prod so the conceptually-wrong reg-vs-tickets comparison
 *     doesn't reach clients. Flip on for diagnostics only.
 *
 *   `FOURTHEFANS_WEBHOOK_SECRET`
 *     Required for the 4thefans webhook handler to accept any
 *     payload. The handler returns 503 with
 *     `{ ok: false, reason: "webhook_secret_unset" }` until it's
 *     configured — refuses to silently accept unsigned bodies.
 *
 * The flag-pair design is deliberate:
 *   - Production default = NEITHER tile renders.
 *   - Diagnostic mode (legacy tile) = legacy on, real off.
 *   - Demo / launch (real tile) = real on, legacy off.
 *   - Dual-on is a no-op; the legacy tile defers to the real one
 *     to avoid a stacked surface (see venue-full-report.tsx).
 *
 * All three helpers read `process.env` directly so this module is
 * safely importable from server components, route handlers, AND
 * client components (Next inlines `NEXT_PUBLIC_` env vars at build
 * time; these three intentionally do NOT use that prefix because
 * the flag state should live server-side and not be readable by an
 * unauthenticated browser — clients learn the state by whether the
 * server emitted the tile at all).
 */

/**
 * Feature-flag normalisation. Mirrors the convention used in
 * `lib/enrichment/feature-flag.ts`: anything in
 * (false, 0, off, no, "") evaluates false; anything else evaluates
 * true. Unset env vars take the supplied default.
 */
function readFlag(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return defaultOn;
  const v = raw.trim().toLowerCase();
  if (v === "" || v === "false" || v === "0" || v === "off" || v === "no") {
    return false;
  }
  return true;
}

/**
 * `true` when the new RealAttributionTile + verified-matches
 * column should render. Default: off (dark build).
 */
export function isRealAttributionEnabled(): boolean {
  return readFlag("OFFPIXEL_REAL_ATTRIBUTION_ENABLED", false);
}

/**
 * `true` when PR #422's legacy `AttributionGapTile` should render.
 * Default: off in prod. The new tile takes precedence when both
 * flags are `true` (see `venue-full-report.tsx`).
 */
export function isLegacyAttributionTileEnabled(): boolean {
  return readFlag("OFFPIXEL_LEGACY_ATTRIBUTION_TILE", false);
}

/**
 * Read the 4thefans webhook secret. Returns `null` when unset so
 * the route handler can return a 503 instead of silently accepting
 * unsigned bodies. The trim here matches the rule used for
 * `CRON_SECRET` in `app/api/internal/refresh-active-creatives/route.ts`.
 */
export function getFourthefansWebhookSecret(): string | null {
  const raw = process.env.FOURTHEFANS_WEBHOOK_SECRET;
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
