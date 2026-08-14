# Session log

## PR

- **Number:** 770
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/770
- **Branch:** `cursor/traffic-adset-destination-type`

## Summary

Traffic campaigns launched via the wizard omitted `destination_type` on ad
set create. Meta's newer Ads Manager Edit UI then defaulted the destination
radio to "Facebook event" when the associated Page had upcoming events —
delivery still worked via `link_data.link`, but the Edit view looked broken
and an operator save would nuke website delivery. Reproducer: Modern Funktion
— Traffic (campaign 120251191631740755). `buildAdSetPayload` now sets
`destination_type: "WEBSITE"` for traffic and registration; awareness /
engagement / purchase leave it unset. Includes a dry-run-default backfill
script for already-launched Traffic ad sets.

## Scope / files

- `lib/meta/adset.ts` — `MetaAdSetDestinationType`, `resolveAdSetDestinationType`, wired into `buildAdSetPayload`
- `lib/meta/__tests__/adset-destination-type.test.ts` — objective/goal matrix
- `scripts/backfill-traffic-destination-type.mjs` — published-draft discovery + PATCH, 1/sec, `--live` / `--campaign-ids`

## Validation

- [x] `node --test` adset-destination-type + blank + dynamic-creative — 22/22 pass
- [x] eslint on touched TS — 0 errors (pre-existing unused-param warnings only)
- [ ] Manual: relaunch Traffic → Meta Edit UI shows Website radio with URL
- [ ] Dry-run then `--live` backfill for Modern Funktion / Puzzle Southampton

## Notes

- Registration also gets WEBSITE (website Sign Up CTA, not Instant Forms / `LEAD`).
- Purchase left unset — not in the reported failure mode.
