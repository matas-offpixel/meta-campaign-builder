# Session log — pr-622-cursor-tag-history-option-b

## PR

- **Number:** 622
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/622
- **Branch:** `cursor/tag-history-option-b`

## Summary

Third attempt at Mailchimp tag history backfill. The previous approach (PR #617, await-fixed in #619) called Mailchimp's segment-members API with `fields=members.id,members.tags` — but the `tags` array is not reliably populated by that endpoint, so the function always produced zero `date_added` strings and wrote nothing. This PR replaces that path with "Option B": backwards-walk from `event_daily_rollups.meta_regs`.

## Root cause

`getSegmentMembers` requests `fields=members.id,members.tags` but Mailchimp's `/lists/{id}/segments/{id}/members` endpoint only reliably returns `members.id`. The `tags` sub-array is apparently not populated via the segment-members route; it requires the top-level `/members` endpoint or per-member `/members/{hash}/tags` (2,000+ calls for Camelphat — too expensive). The function silently returned `{ ok: true, rowsWritten: 0 }` after iterating 2,334 members with empty tag arrays.

## What changed

### `lib/mailchimp/sync.ts`

`syncMailchimpTagDailyHistory` completely rewritten:

**Before (Option A — broken):**
- Resolved Mailchimp credentials
- Called `getAudienceSegments` to find the segment ID
- Paginated `getSegmentMembers` (2,334 API calls for Camelphat)
- Tried to extract `date_added` from each member's `tags` array (always empty)
- Wrote nothing

**After (Option B — backwards-walk):**
1. Read the latest `mailchimp_tag_snapshots` row as the cumulative anchor (today's real count)
2. Query `event_daily_rollups.meta_regs` for the campaign window
3. Walk backwards: `cumulative -= meta_regs_delta` per day, floor at 0
4. Delete existing `source=mailchimp_tag_daily_history` rows in the window (leaves point-in-time cron rows untouched)
5. Insert reconstructed rows with `method: "backwards_walk_daily_rollups"` in `raw_json`

No Mailchimp API calls. Completes in O(N rollup rows). All log lines use `console.error` (Vercel filters `console.log` under load — PR #514/#525/#619 pattern).

Trade-off: Meta REG counts proxy Mailchimp tag-add events. Non-Meta sources (TikTok, direct, Google) contribute to Mailchimp but not `meta_regs`. Mid-window cumulatives may under-count by ~5–10%. End-of-window number is exact.

`getSegmentMembers` removed from the import (unused).

### `lib/mailchimp/client.ts`

Added JSDoc warning on `getSegmentMembers` explaining the `tags` array limitation and pointing to the backwards-walk approach for historical reconstruction.

## Validation

```bash
curl -X POST "https://app.offpixel.co.uk/api/events/14d55718-ffa5-490e-b555-2423bc22f05e/mailchimp/refresh" \
  -H "Authorization: Bearer $CRON_SECRET" --http1.1 --max-time 30
```

Expected Vercel log:
```
[mailchimp-tag-history] event=14d55... backwards-walk wrote N rows 2026-06-16..2026-06-21 anchor=2026-06-21:2334
```

Expected Supabase (source should be `mailchimp_tag_daily_history`):
```sql
SELECT snapshot_at::date AS day, email_subscribers, raw_json->>'source' AS source
FROM mailchimp_tag_snapshots
WHERE event_id = '14d55718-ffa5-490e-b555-2423bc22f05e'
ORDER BY snapshot_at;
```

## Checklist

- [x] `npm run build` — clean
- [x] `npx eslint lib/mailchimp/sync.ts lib/mailchimp/client.ts` — 0 warnings
