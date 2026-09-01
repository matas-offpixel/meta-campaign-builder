# Session log

## PR

- **Number:** 874
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/874
- **Branch:** `cursor/unmatched-campaign-code-guard`
- **Parent sha:** `c581a4f` (`feat(optimisation): CBO campaign-grain evaluation… (#873)`)

## Summary

Name the silent `[CODE]` miss. A Meta campaign whose bracket prefix matches no active event (FOLMAOUR vs FOLAMOUR) was dropped by the event-centric matcher with no log. The rollup-sync cron now scans account-level campaign spend (`last_7d`), alarms `ads_ops` when spend is at least **£25**, and lists findings on `/admin/cron-health`. Attribution is unchanged. No Meta writes. No auto-rename.

## Inventory

### Where `[CODE]` is parsed and matched

- **Parse:** first `[…]` in the campaign name. Shared as `parseBracketedEventCode` in `lib/insights/meta-event-code-match.ts` (same regex as `extractEventCode` in `lib/audiences/naming.ts`).
- **Match (event-centric):** `campaignMatchesBracketedEventCode(name, eventCode)` — exact `[event_code]` substring after dash normalisation. `listCampaignsForEvent` CONTAINs `[event_code]` on Graph, then post-filters.
- **Consumers:** rollup-sync Meta leg, lifetime/daily insights, venue allocator, audience bulk-video. All start from a known event_code.

### What happened to an unmatched campaign (before)

Nothing named. The campaign was never selected. Zero rollup rows, zero Slack, zero UI. The event page looked quiet. Same success-shaped empty pipe as #836 `rollup_tickets_dead`.

### Operator surface home

`/admin/cron-health` — silent-failure monitor, operator-wide. The client `/clients/[id]/campaigns` view is event-scoped; unmatched codes never appear there.

## Threshold

`UNMATCHED_CAMPAIGN_SPEND_FLOOR_MAJOR = 25` (GBP) in Meta `date_preset=last_7d`. Zero-spend and sub-£25 test campaigns stay silent.

Active event statuses: `on_sale` / `live` / `upcoming` (same as rollup code-match eligibility). A code that only exists on `completed`/`cancelled` is unmatched.

Dedupe key: `unmatched_campaign:{campaignId}:{code}` via existing `notify()` + `notification_dedupe_state`. Channel `ads_ops`. `respectBusinessHours: false` so a £541 typo does not wait for Monday.

Snapshot key `unmatched_campaigns:last_scan` holds the current list for the cron-health table.

## Scope / files

- `lib/insights/unmatched-campaign-code.ts` + tests
- `lib/insights/meta-event-code-match.ts` — additive `parseBracketedEventCode` only
- `lib/dashboard/unmatched-campaign-code-scan.ts`
- `lib/db/unmatched-campaign-findings.ts`
- `app/api/cron/rollup-sync-events/route.ts`
- `app/(dashboard)/admin/cron-health/page.tsx`

## Validation

- [x] `npx eslint` on touched files
- [x] `npm run build`
- [x] `npm test` — **4757** tests, **4754** pass, **0** fail, **3** skipped
- [x] Parent-sha falsify vs `c581a4f`

## Notes

- Matcher behaviour otherwise unchanged.
- Cron-health list was not browser-verified (auth-gated).
