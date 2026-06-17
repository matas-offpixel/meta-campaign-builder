# Session log — per-event Mailchimp tag-scoped registration snapshots

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/mailchimp-event-tag-sync`

## Summary

Ironworks shares one Mailchimp audience (`6b62bb8448`) across 7 events. Before this change,
share reports for every single-event show (IRW0001–IRW0006) displayed the whole-list total
(~4,054 contacts) as Registrations, wildly over-stating CPR. This PR adds:

1. `events.mailchimp_tag` — nullable column; when set, scopes Mailchimp registration counts to
   the tag's static segment rather than the whole audience.
2. `mailchimp_tag_snapshots` table — per-day tag-scoped member counts, mirroring
   `mailchimp_audience_snapshots` shape.
3. Cron extension — `sync-mailchimp-audiences` gains a second pass that syncs a tag row for
   every event with `mailchimp_tag IS NOT NULL`.
4. Reader extension — share report + `loadEventRegistrations` + manual-refresh endpoint all
   prefer `mailchimp_tag_snapshots` when the tag column is set; brand_campaign always-on events
   fall through to the existing audience path (no regression).

**Backfill required post-merge** (manual SQL in Supabase):
```sql
UPDATE events SET mailchimp_tag = 'Camelphat - London' WHERE event_code = 'IRW0004';
```

## Scope / files

- `supabase/migrations/118_event_mailchimp_tag.sql` — new: column + table + RLS
- `lib/mailchimp/client.ts` — add `getAudienceSegments` / `MailchimpSegment`
- `lib/mailchimp/sync.ts` — add `MailchimpTagSyncEventRow`, `SyncMailchimpTagResult`,
  `syncMailchimpTagForEvent`
- `app/api/cron/sync-mailchimp-audiences/route.ts` — two-pass: audience + tag
- `app/api/events/[id]/mailchimp/refresh/route.ts` — prefer tag sync when `mailchimp_tag` set
- `lib/mailchimp/registrations-loader.ts` — prefer `mailchimp_tag_snapshots` when tag present
- `app/share/report/[token]/page.tsx` — include `mailchimp_tag` in event select; prefer tag
  snapshots; lift `brand_campaign` guard on registrationsData + mailchimpSlot

## Validation

- [x] `npm run build` — clean (0 errors)
- [x] `npm run lint` — no new errors in changed files
- [ ] `npm test`
- [ ] Migration applied to prod and `IRW0004` backfill run
- [ ] Next cron run confirms `mailchimp_tag_snapshots` row for `IRW0004` < 4,054
- [ ] Share report for IRW0004 shows Camelphat tag count, not 4,054

## Validation queries (run after migration + cron)

```sql
-- Verify tag row landed
SELECT snapshot_at, email_subscribers, total_contacts
FROM mailchimp_tag_snapshots
WHERE event_id = '14d55718-ffa5-490e-b555-2423bc22f05e'
ORDER BY snapshot_at DESC LIMIT 5;

-- Sanity: audience total > tag total
SELECT
  (SELECT email_subscribers FROM mailchimp_audience_snapshots
   WHERE event_id = '14d55718-ffa5-490e-b555-2423bc22f05e'
   ORDER BY snapshot_at DESC LIMIT 1) AS audience_total,
  (SELECT email_subscribers FROM mailchimp_tag_snapshots
   WHERE event_id = '14d55718-ffa5-490e-b555-2423bc22f05e'
   ORDER BY snapshot_at DESC LIMIT 1) AS camelphat_tag_total;
```

## Notes

- Tags in Mailchimp appear as `type="static"` segments in `/lists/{id}/segments`. The
  `syncMailchimpTagForEvent` function matches by case-insensitive name. If the tag name changes
  in Mailchimp, update `events.mailchimp_tag` to match.
- No daily history reconstruction for tag snapshots (unlike the audience path which uses
  `getAudienceListActivity`). Each cron run writes one live snapshot; the trend chart aggregator's
  carry-forward pass fills calendar gaps. History will accumulate day-by-day from first sync.
- Pattern is reusable: set `mailchimp_tag` on any future Ironworks event (IRW0001–IRW0006) once
  their tags are live in Mailchimp. Same for J2 or other multi-event shared-audience clients.
