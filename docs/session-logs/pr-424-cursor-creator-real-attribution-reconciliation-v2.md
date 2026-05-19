# Session log — real attribution reconciliation v2 (dark)

## PR

- **Number:** 424
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/424
- **Branch:** `cursor/creator/real-attribution-reconciliation-v2`

## Summary

Replaces PR #422's conceptually-flawed "Meta-conversions vs ticket-
sales" comparison with a purchase-event-specific reconciliation: for
every event we now expose `metaReportedPurchases` (X), `offpixel-
AttributedPurchases` (Y) and `ticketsTrue` (Z), plus `Y/X` (Trust)
and `Y/Z` (Coverage) ratios. Everything ships behind two new feature
flags, defaulting to off — the new `RealAttributionTile`,
the campaigns-tab "Sales (verified)" swap and the existing
`AttributionGapTile` from PR #422 are all hidden in prod until
flag-flip. The webhook handler that ingests 4thefans purchase events
is gated on a new `FOURTHEFANS_WEBHOOK_SECRET` and refuses to
silently accept unsigned webhooks.

This is a dark build: all infrastructure exists, all tests pass,
nothing user-visible changes until the flag flip after Joe's
ticketing webhook payload extension lands.

## Scope / files

**Migrations**
- `supabase/migrations/093_meta_purchases_split.sql` — splits Meta
  conversion events into `meta_purchases` + `meta_leads` columns on
  `event_daily_rollups`. Preserves `meta_regs` for backwards-compat.
- `supabase/migrations/094_attribution_matching_tables.sql` —
  `ticketing_purchase_events`, `meta_click_touchpoints`,
  `attribution_order_matches` with RLS + indexes.

**New libraries (pure, fully unit-tested)**
- `lib/attribution/hashing.ts` + `__tests__/hashing.test.ts`
- `lib/attribution/matcher.ts` + `__tests__/matcher.test.ts` (10+ cases)
- `lib/attribution/feature-flags.ts`
- `lib/attribution/cron-auth.ts`
- `lib/attribution/webhook-parser.ts` + `__tests__/webhook-parser.test.ts`
- `lib/cron/match-attribution.ts`
- `lib/dashboard/real-attribution-bands.ts` +
  `__tests__/real-attribution-bands.test.ts`
- `lib/dashboard/__tests__/canonical-event-metrics-real-attribution.test.ts`

**API routes**
- `app/api/webhooks/ticketing/[provider]/route.ts` — provider-keyed
  ingest. 503s when `FOURTHEFANS_WEBHOOK_SECRET` is unset.
- `app/api/track/meta-click/route.ts` — public POST, IP-based rate
  limit, `_fbc` cookie, upserts on `fbclid`.
- `app/api/internal/match-attribution/route.ts` — Vercel cron
  transport (`30 */6 * * *`, maxDuration 300).
- `app/api/admin/backfill-meta-purchase-split/route.ts` — idempotent
  90-day backfill of meta_purchases + meta_leads.

**Resolver + UI**
- `lib/dashboard/canonical-event-metrics.ts` — four new fields,
  `sumCanonicalEventMetrics` recomputes ratios from raw counts.
- `lib/dashboard/canonical-event-metrics-loader.ts` —
  `loadPurchaseAttributionMaps` bulk loader.
- `lib/dashboard/campaigns-aggregator.ts` — accepts optional
  `verifiedSalesByCampaignId` / `verifiedSalesByAdsetId` maps that
  override spend-share allocation when real-flag is on.
- `components/dashboard/event-report/RealAttributionTile.tsx` —
  three numbers + two badges + collapsible explainer.
- `components/share/venue-full-report.tsx` —
  flag-driven dual-tile combinator.
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` +
  `app/share/venue/[token]/page.tsx` — wire the loader through.

**Pipeline plumbing**
- `lib/insights/types.ts` + `lib/insights/meta.ts` — bucket Meta
  `actions{action_type,value}` into purchase / lead buckets.
- `lib/db/event-daily-rollups.ts` + `lib/dashboard/rollup-sync-runner.ts`
  — thread the new fields through pad-today + window-pad paths.
- `vercel.json` — adds match-attribution cron.

**Docs + env**
- `docs/REAL_ATTRIBUTION_ARCHITECTURE.md` — three-number thesis +
  Joe dependency + flag-flip checklist.
- `.env.local.example` — three new flags documented.

## Validation

- [x] `npm run lint` — no new errors in PR-touched files; all 18
      remaining errors pre-date this PR.
- [x] `npm run build` — exit 0.
- [x] `node --test 'lib/dashboard/__tests__/*.test.ts'
      'lib/attribution/__tests__/*.test.ts'` — 451 pass / 0 fail
      (1 pre-existing skip).
- [x] No new ReadLints diagnostics on any of the 19 new/edited files.

## Notes

- Migrations 093 + 094 to be applied via Supabase MCP after merge.
  See doc for the full flag-flip checklist.
- Backfill route is idempotent (relies on existing `metaDataMatch`
  no-op skip in `event-daily-rollups.ts`) and rate-limit aware
  (calls `fetchEventDailyMetaMetrics` per-event with a 250ms gap).
- Rate-limit for `/api/track/meta-click` is in-memory per instance
  — fine for the dark-build smoke test; revisit when the snippet
  ships in a follow-on PR (Redis-backed limiter).
- HMAC signature contract for `fourthefans` is documented as the
  interim default while Joe finalises his spec. If it lands
  differently we re-version under
  `/api/webhooks/ticketing/fourthefans-v2/`.
- Pre-existing `lib/audiences/__tests__/batch-fetch-video-metadata.test.ts`
  failure is unrelated — confirmed by stashing all PR work and
  re-running that single test.
