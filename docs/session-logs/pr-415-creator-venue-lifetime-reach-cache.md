# Session log — venue lifetime Reach cache

## PR

- **Number:** 415
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/415
- **Branch:** `cursor/creator/venue-lifetime-reach-cache`

## Summary

Implements **PR A** from the Plan PR `docs/PLAN_VENUE_REACH_AND_LONDON_UMBRELLA_2026-05-13.md`
(greenlit by Matas on 2026-05-14). Replaces the venue-card "Reach (sum)"
cell — which was inflated ~2.2× because it summed daily deduplicated
reach values across days — with Meta's campaign-window lifetime
deduplicated reach, fetched ONCE per `(client_id, event_code)` per
cron tick and cached in a new `event_code_lifetime_meta_cache` table
(migration 068). The cell label is now plain "Reach" with the tooltip
Matas approved (Q5): "Unique people reached across this venue's
campaigns — matches Meta Ads Manager's deduplicated reach figure."

Pinned acceptance numbers (Plan PR §6):

- WC26-MANCHESTER reach: ~781,346 (was 1,740,469).
- WC26-LONDON-SHEPHERDS reach: ~175,330 (was 1,231,744).
- WC26-LONDON-KENTISH reach: ~331,552 (was inflated by umbrella mix).

## Scope / files

- `supabase/migrations/068_event_code_lifetime_meta_cache.sql` — new
  table with `(client_id, event_code)` PK, `meta_*` lifetime columns,
  `fetched_at` for cron freshness, RLS via `clients.user_id`.
- `supabase/schema.sql` — schema dump updated with table + indexes.
- `lib/insights/meta.ts` — new `fetchEventLifetimeMetaMetrics` helper.
  No `time_increment`, `date_preset=maximum`, case-sensitive
  bracket-match post-filter. Glasgow umbrella special-case
  intentionally NOT ported (Plan PR §3 — venue cards show only
  bracket-matching campaigns).
- `lib/db/event-code-lifetime-meta-cache.ts` — CRUD wrapper:
  `loadEventCodeLifetimeMetaCache`,
  `loadEventCodeLifetimeMetaCacheForClient`,
  `upsertEventCodeLifetimeMetaCache`,
  `isEventCodeLifetimeMetaCacheFresh` (drives sibling-skip
  optimisation — 4-fixture venue does ONE Meta call per cron tick,
  not four).
- `lib/dashboard/rollup-sync-runner.ts` — new lifetime leg between
  the Meta daily upsert and the spend allocator. Fails closed
  (no impact on existing rollups, allocator, or summary `ok`).
- `lib/db/client-portal-server.ts` — `ClientPortalData` extended
  with `lifetimeMetaByEventCode`. Bulk loaded in the parallel
  `Promise.all` batch. `loadVenuePortalByToken` filters down to
  the venue's own `event_code` so the share JSON doesn't leak
  sibling totals.
- `components/share/venue-stats-grid.tsx` — new `lifetimeMeta` prop.
  Reach cell swaps label / tooltip / value when
  `(platform === 'meta' || platform === 'all')` AND `windowDays === null`
  AND cache present. Falls back to legacy "Reach (sum)" otherwise.
- `components/share/venue-full-report.tsx` — declares the new prop,
  looks up the matching cache row by `event_code`, threads to
  `<VenueStatsGrid>`.
- `app/share/venue/[token]/page.tsx`,
  `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` —
  thread `lifetimeMetaByEventCode` from the loader.
- `app/api/admin/event-code-lifetime-meta-backfill/route.ts` —
  manual / cron-secret backfill route. POST takes optional
  `client_id` / `event_code` filters; populates the cache for every
  matching `(client_id, event_code)` pair. Used to bootstrap the
  cache pre-Friday demo without waiting on the next cron tick.
- `lib/db/__tests__/event-code-lifetime-meta-cache.test.ts` — 6 unit
  tests for the CRUD wrapper (round-trip, idempotency, freshness
  guard contract).
- `lib/dashboard/__tests__/venue-stats-grid-lifetime-reach.test.ts` —
  13 pipeline / wire-up tests pinning the Manchester /
  Shepherd's Bush / Kentish numbers and asserting the loader, runner,
  grid, and full-report wiring.

## Validation

- [x] `npm run build` — clean, all routes compile.
- [x] `npm test` — 1130 pass, 1 fail (pre-existing
  `batch-fetch-video-metadata.test.ts` — not introduced by this PR).
- [x] `npm run lint` — no new errors / warnings in touched files.
  Pre-existing repo-wide errors unchanged.
- [x] All 19 new tests pass.

## Smoke test (per Matas' instruction)

Before merge:

```sql
SELECT meta_reach FROM event_code_lifetime_meta_cache
WHERE event_code = 'WC26-MANCHESTER';
```

Expected: ~781,346 (within Meta API jitter ±2%).

To populate the cache without waiting for the cron, call the admin
route after deploy:

```
POST /api/admin/event-code-lifetime-meta-backfill
Authorization: Bearer ${CRON_SECRET}
Content-Type: application/json

{ "event_code": "WC26-MANCHESTER" }
```

Or trigger a venue rollup-sync via the dashboard's "Sync now" button —
the lifetime leg now runs as part of the standard sync.

## Notes

- **Glasgow venue cards will show LOWER reach** post-merge than they
  did pre-merge. The Glasgow daily helper folds the WC26-GLASGOW
  umbrella spend into venue siblings via date-based attribution; the
  lifetime helper does NOT (lifetime is one number, can't be
  date-split). Per the Plan PR's "venue cards show only bracket-
  matching campaigns" rule this is the desired behaviour. If Glasgow
  ops complain, follow-up is a "WC26-GLASGOW umbrella" tile.
- **PR B (London umbrella panel) deferred** per Q4. The diagnosis
  in the Plan PR confirmed there's no current umbrella bleed; build
  the panel only if Joe complains after PR A ships.
- **Cache scope** intentionally includes `link_clicks`, `meta_regs`,
  `engagements`, video plays, and impressions per Q3 — anything
  Meta dedupes inside a campaign window. Future PR can wire those
  cells to lifetime values too; this PR ships only the Reach cell
  swap because that's what Joe needs reconciling for Friday.
- **No new dependencies** added.
