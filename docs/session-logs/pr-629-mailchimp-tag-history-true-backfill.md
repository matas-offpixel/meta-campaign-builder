# Session log — mailchimp tag history true backfill

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/mailchimp-tag-history-true-backfill`

## Summary

Previous attempts at reconstructing Mailchimp tag history used unreliable approaches (Option A: segment-members tags sub-array — not populated reliably; Option B: Meta REGS delta proxy — ~40% under-attributed; Options C/D: linear/weighted ramp — estimates, not real data). This PR implements Option D: for each segment member, call `GET /lists/{listId}/members/{memberHash}/tags` to read the true `date_added` per contact, then bucket by day into a cumulative series and write it to `mailchimp_tag_snapshots`. No INSERTs from estimates — 100% API-sourced truth.

## Scope / files

- `lib/mailchimp/client.ts` — adds `getAllSegmentMemberIds` and `getMemberTagDateAdded` exports used by the backfill route
- `app/api/events/[id]/mailchimp/tag-history-backfill/route.ts` — new POST endpoint; `maxDuration=900` for Vercel Pro 15-min cap
- `lib/auth/public-routes.ts` — allowlist entry so `Bearer CRON_SECRET` bypasses middleware

## Validation

- [x] `npx tsc --noEmit` — no new errors (pre-existing framework-generated errors unrelated)
- [x] `npm run build` — clean

## Notes

- Rate limit: 100ms delay between per-member calls → ~10 calls/sec. IRWOHD ~6,830 members ≈ 11–12 min. Camelphat ~2,400 members ≈ 4 min.
- Safety cap: aborts after 50 consecutive per-member errors to avoid infinite loops.
- Existing `mailchimp_tag_snapshots` rows **outside** the backfilled date range are preserved (DELETE uses `.gte(firstDay).lte(lastDay)`).
- `raw_json.method = "per_member_tag_date_backfill"` — chart/Daily Tracker already pass this through correctly (not filtered as ramp data).
- Daily Tracker REGS column deltas will compute naturally from the true cumulative series once the backfill runs.
- Estimated cost: ~1 HTTP call per member → IRWOHD ~6,830 calls + 7 pages. Within Mailchimp's 10/sec practical limit with 100ms delay.
