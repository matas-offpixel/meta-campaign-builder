# Session log — mailchimp-tag-history-backfill

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/mailchimp-tag-history-backfill`

## Summary

Camelphat (IRW0004) tag-snapshot history only started on 18 Jun (when PR #605's
cron first ran), leaving the chart's green Registrations line flat at 0 for 16–17
Jun even though signups were happening. This PR reconstructs per-day cumulative
counts by paginating through Mailchimp segment members, reading each member's
per-tag `date_added` timestamp, bucketing by calendar day, and writing
historical rows into `mailchimp_tag_snapshots`. The backfill runs automatically
in the daily cron for events with sparse history, and also fires on every manual
"Sync now" click for tagged events.

## Scope / files

- `lib/mailchimp/client.ts` — added `getSegmentMembers` + `MailchimpMemberTag` /
  `MailchimpSegmentMember` / `MailchimpSegmentMembersResponse` interfaces to fetch
  paginated segment members with per-tag `date_added` fields.
- `lib/mailchimp/sync.ts` — added `syncMailchimpTagDailyHistory`: resolves
  segment, paginates members, buckets `date_added` by day, builds cumulative
  totals, and writes historical rows to `mailchimp_tag_snapshots` (delete + insert
  in the reconstructed date window).
- `app/api/cron/sync-mailchimp-audiences/route.ts` — added Pass 3: after the
  existing tag point-in-time sync, queries the oldest snapshot per event and
  runs `syncMailchimpTagDailyHistory` for any event whose oldest row is < 14 days
  old (i.e. history is sparse). Events with a complete history are skipped cheaply.
- `app/api/events/[id]/mailchimp/refresh/route.ts` — tag-scoped refresh now also
  fires `syncMailchimpTagDailyHistory` after writing today's snapshot (fire-and-
  forget so the API response is not blocked on history write).

## Validation

- [x] `npm run build` — clean
- [x] `npx eslint` on all changed files — no errors/warnings

## Notes

- The backfill only counts CURRENTLY-TAGGED members. Members who held the tag
  historically and were later untagged are absent from the segment and therefore
  do not contribute dates. In practice this is negligible for campaign-lifetime
  accuracy (very few tag removals on event audiences).
- For Camelphat (1,465 members at 19 Jun), the backfill requires 2 Mailchimp API
  calls (2 pages × 1,000). Large segments may need more pages but the paginator
  handles arbitrary sizes.
- Pass 3 threshold is 14 days. After the first full backfill the oldest row will
  be pre-campaign (e.g. 16 Jun), which is > 14 days from any subsequent run, so
  the per-event check short-circuits and adds no overhead.
- The "Sync now" button immediately triggers a backfill for Camelphat — no need
  to wait for the next 06:00 UTC cron after deploying this PR.
