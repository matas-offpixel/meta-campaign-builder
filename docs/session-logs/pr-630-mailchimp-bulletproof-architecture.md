# Session log — mailchimp bulletproof tag-tracking architecture

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/mailchimp-bulletproof-architecture`

## Summary

Replaces the synchronous per-member tag backfill (PR #629), which re-fetched every
contact's tags on every request and timed out at Ironworks scale (6 events × 5k+
contacts). Introduces a layered, scale-safe architecture: real-time webhooks +
a daily EOD reconciliation cron + a resumable one-time historical backfill job.
After this ships, daily Mailchimp API load is constant (~12 calls + webhook
traffic) regardless of contact count, and the chart shows 100% real, API-sourced
cumulative data with zero estimates.

## Scope / files

- `supabase/migrations/119_mailchimp_bulletproof_tracking.sql` — new tables
  `mailchimp_tag_event_log`, `mailchimp_tag_backfill_jobs`; generated
  `mailchimp_tag_snapshots.day` column + index. (No unique `(event_id, day)`
  index — live data has intra-day dupes; deterministic `T12:00:00Z` writes dedupe
  via the existing `uq_…_event_snapshot_at` index instead.)
- `lib/mailchimp/tag-tracking.ts` — shared helpers (`daySnapshotAt`,
  `recomputeDaySnapshot`, `md5Email`, `isCronAuthorized`, `resolveAppBaseUrl`).
- `lib/mailchimp/client.ts` — adds `getSegmentMemberIdsPage` (offset paging).
- Layer 1 webhook: `app/api/webhooks/mailchimp/[clientId]/[audienceId]/route.ts`.
- Layer 2 EOD cron: `app/api/cron/mailchimp-eod-snapshot/route.ts`.
- Layer 3 backfill: `app/api/cron/mailchimp-backfill-tick/route.ts`,
  `app/api/events/[id]/mailchimp/tag-backfill/{start,status}/route.ts`.
- `vercel.json` — EOD cron (23:55) + per-minute backfill-tick cron.
- `lib/auth/public-routes.ts` — allowlist for webhook + tag-backfill endpoints;
  removed the deprecated `tag-history-backfill` carve-out.
- Removed `app/api/events/[id]/mailchimp/tag-history-backfill/route.ts` (PR #629).
- `CLAUDE.md` — env var + architecture/webhook-setup documentation.

## Validation

- [x] `npx tsc --noEmit` — no new errors (2 pre-existing test errors confirmed on `main`)
- [x] `npm run build` — clean
- [x] `eslint` on all new/changed files — clean
- [x] Migration expression verified IMMUTABLE against live DB (generated column valid)

## Notes / rollout (ops)

1. Apply `119_mailchimp_bulletproof_tracking.sql`.
2. Deploy code.
3. Set `MAILCHIMP_WEBHOOK_SECRET` in Vercel env.
4. Configure Mailchimp webhook (Ironworks audience): URL
   `https://app.offpixel.co.uk/api/webhooks/mailchimp/{clientId}/{audienceId}?secret={MAILCHIMP_WEBHOOK_SECRET}`,
   enable tag add/remove.
5. `POST /api/events/68535c85-0394-435f-9439-245dd2e87043/mailchimp/tag-backfill/start`
   (IRWOHD), poll `…/status` until `completed`.

### Design decisions vs. the spec

- **No `@vercel/functions` dependency** (repo rule: no new deps). The tick is
  driven by a per-minute Vercel cron with a best-effort fire-and-forget self-fire
  to chain chunks; the cron is the reliable backstop.
- **Deterministic per-day `snapshot_at` (`T12:00:00Z`)** instead of a new unique
  `(event_id, day)` constraint, because live data already has multiple intra-day
  rows and a unique index would require destructive dedupe. All writers
  (webhook/EOD/backfill) share the timestamp, so the existing
  `(event_id, snapshot_at)` unique index dedupes to one row per day.
- **EOD reconciliation reuses `getAudienceSegments`** (returns `member_count`)
  rather than a separate `/segments/{id}` call — one API call per event.
- **Backfill idempotency:** per-day additions accumulate in `job.summary` and the
  cursor advances in the same atomic UPDATE; snapshots are materialised once at
  finalize (DELETE range + INSERT), so re-running a chunk can't double-count.
- Legacy Pass 3 (weighted-ramp history) in `sync-mailchimp-audiences` is left
  intact; it self-skips once true history exists (oldest snapshot older than the
  14-day threshold).
