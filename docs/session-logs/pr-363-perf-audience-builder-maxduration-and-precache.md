# Session log — perf/audience-builder-maxduration-and-precache (PR-D)

## PR

- **Number:** 363
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/363
- **Branch:** `perf/audience-builder-maxduration-and-precache`

## Summary

Eliminate the Audience Builder video-views timeout. Replace the
module-level `Map` cache (which dies on every Vercel cold start)
with a DB-backed `audience_source_cache` table that survives
serverless instance churn and is shared across users targeting the
same client. Bump `maxDuration` on the two heaviest routes from
the 10s default to 60s. Pre-warm the top-3 most-recent campaigns
when the Audience Builder picker mounts so cold-cache callers
already see warmed entries by the time they pick a Video Views
preset.

Fixes the J2-scale (~200 video) campaign timeout that's been
blocking BB bottom-funnel relaunch.

## Scope / files

- `supabase/migrations/087_audience_source_cache.sql` — new table
  keyed on `(user_id, client_id, source_kind, cache_key)`. Stores
  payload JSONB, `expires_at`, and `build_version` (stamped with
  `VERCEL_GIT_COMMIT_SHA`). RLS owner-SELECT; writes are
  service-role only via the cache helper. Note: project is at
  mig 086; renumbered from the brief's "080" so it lands cleanly
  on the live sequence.
- `lib/audiences/source-cache-db.ts` — new module exporting
  `getCachedAudienceSourceDb({ userId, clientId, sourceKind,
  cacheKey, ttlMs, load })`. Reads + writes via the service-role
  client. HIT contract: `expires_at > now()` AND build_version
  matches. Skips writes for empty payloads (mirrors existing
  `audienceSourcePayloadIsCacheable`).
- `lib/audiences/source-cache.ts` — flag the existing Map cache
  helper `@deprecated`. Implementation kept working because
  `lib/audiences/__tests__/source-cache.test.ts` still imports it.
- `app/api/audiences/sources/campaign-videos/route.ts` — add
  `export const maxDuration = 60` and swap to the DB cache helper.
- `app/api/audiences/sources/multi-campaign-videos/route.ts` —
  same change.
- `app/api/audiences/sources/prewarm/route.ts` — new POST route.
  Body `{ clientId }`. Resolves the client's 3 most-recent Meta
  campaigns from `events.meta_campaign_id` (sorted by event_date),
  fires `fetchAudienceCampaignVideos` for each via the DB cache
  in a `Promise.allSettled`, returns 200 immediately. `waitUntil`
  used when available, fire-and-forget otherwise.
- `app/(dashboard)/audience-builder/client-picker.tsx` — fire
  the prewarm route on mount (for the last-used client) and on
  every card click (for the chosen client). Best-effort; never
  blocks the picker UI.

## Validation

- [x] `npm test` — 853 pass / 0 fail.
- [x] `npm run build` — clean, all five `/api/audiences/sources/*`
      routes register including the new prewarm endpoint.
- [x] No new lint warnings on the changed files.
- [ ] **Apply migration 087 via Supabase MCP before / immediately
      after merge.** The cache helper soft-fails on missing table
      so the live fetch path keeps working; cache hits will only
      land once the migration is applied.
- [ ] Cold-load Audience Builder for 4thefans → click "Video Views
      (75%)" on a J2-scale campaign → returns within 30s, no
      timeout error. Second user / second cold-start hits cache
      (verify by selecting from `audience_source_cache` after the
      first fetch).

## Notes

- Migration renumbered from the brief's `080` to `087` because
  `supabase/migrations/080_wc26_manchester_fixture_dates.sql`
  already exists.
- The `pages` and `pixels` routes still call the deprecated Map
  helper. They're cheaper (single Meta call, no per-video fan-out)
  so the cold-start hit is barely visible. Migrating them is a
  follow-up — out of scope for the BB-relaunch unblock.
- The prewarm route resolves recent campaigns by looking up
  `events.meta_campaign_id` rather than calling Meta's
  `act_X/campaigns` endpoint. Cheaper, no rate-limit risk, and
  reflects what the operator actually built campaigns for.
- The DB cache helper logs warnings on read/write failure but
  never throws — a broken cache can't take down the Audience
  Builder. The live fetch still runs.
- `VERCEL_GIT_COMMIT_SHA` is the canonical build_version stamp,
  matching `active_creatives_snapshots` (mig 067). Mismatched /
  NULL build_version is treated as stale.
