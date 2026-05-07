# Session log

## PR

- **Number:** 331
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/331
- **Branch:** `fix/active-creatives-cron-eligibility`

## Summary

Diagnosed why Bristol/Edinburgh/Leeds WC26 events produce zero
`active_creatives_snapshots` despite passing cron eligibility. The root cause is
`listLinkedCampaignIds` filtering to `ACTIVE | PAUSED | CAMPAIGN_PAUSED` only —
campaigns archived after an on-sale window closes are excluded, so no campaign
rows are returned, `campaigns_total === 0`, and `kind="skip"` with
`reason="no_linked_campaigns"` prevents any snapshot write. Adding `ARCHIVED` to
the filter fixes it: creative history from archived campaigns is still valid for
retrospective reporting (consistent with the existing PAUSED inclusion).

## Scope / files

- `lib/reporting/active-creatives-fetch.ts` — added `"ARCHIVED"` to the
  `effective_status` array in `listLinkedCampaignIds`

## Validation

- [x] `npm test` — 710 pass, 1 skipped, 0 fail
- [ ] After next cron run: confirm Bristol/Edinburgh/Leeds each have ≥4 rows in
  `active_creatives_snapshots`
- [ ] `/clients/.../venues/WC26-BRISTOL` → Top Creatives section populates

## Notes

Cron eligibility was confirmed correct: Bristol/Edinburgh/Leeds qualify via the
code-match path (`status=on_sale`, non-null `event_code`, `event_date` in June
2026 well within 180-day lookback). The fix is entirely in the Meta campaign
discovery layer, not in eligibility.
