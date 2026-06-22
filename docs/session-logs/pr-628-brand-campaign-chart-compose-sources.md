# Session log — brand-campaign chart compose sources

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/brand-campaign-chart-compose-sources`

## Summary

After PR #605 wired tag-scoped Mailchimp sync and `mailchimp_tag = "Website Sign Up"` was set on IRWOHD, the dashboard/share chart's snapshot-selection logic switched to reading `mailchimp_tag_snapshots` exclusively. Since tag snapshots only existed from 19 Jun onward, the chart showed a cliff from 0 → 4,276 on that date, hiding the continuous May 24 → 15 Jun growth recorded in `mailchimp_audience_snapshots`. This PR fixes the read-side composition for `kind="brand_campaign"` events that have both a `mailchimp_tag` and audience history: audience snapshots for dates *before* the earliest tag snapshot are prepended, giving the chart a seamless combined view. Both tables are untouched (no INSERTs, no backfills).

## Scope / files

- `app/api/events/[id]/mailchimp/snapshots/route.ts` — dashboard path: adds `kind` to event select; composes audience + tag rows for `brand_campaign + tag` events
- `app/share/report/[token]/page.tsx` — share-report path: same compose logic in the tag-snapshot block

## Validation

- [x] `npm run build` — clean
- [x] `npm run lint` — no new errors (pre-existing warnings unrelated)

## Notes

- `kind="event"` events with a tag (e.g. Camelphat) are explicitly excluded from the compose path — they use tag snapshots only.
- Daily Tracker REGS column filter (`method !== weighted_ramp_pre_snapshot && !== linear_ramp_pre_snapshot`) already passes audience-snapshot rows through without any change needed.
- LegacyTrendChart lower/upper bound extension (PR #627) naturally expands the x-axis to 24 May once the composed rows arrive.
