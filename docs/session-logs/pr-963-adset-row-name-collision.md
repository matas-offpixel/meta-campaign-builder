# An ad set's name collides with its own location badge

## PR

- **Number:** 963
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/963
- **Branch:** `cursor/adset-row-name-collision`

## Summary

Matas, 23 Sept, on a 2-location / 5-audience campaign (10 ad sets): the Step 5
row name input showed `Newcast` / `Belfast, `. Three causes on one line. The
location badge was `shrink-0` and carried the full Meta path
(`Newcastle upon Tyne, England, United Kingdom (+200 km)`). The name column
beside ~650px of `shrink-0` controls had `min-w-0`, so it could collapse to
nothing. And `generateSuggestions` also wrote ` — {full label}` into the name,
so the location appeared twice. `truncate` on the `<input>` never did
anything, because `text-overflow` does not apply to an input's value.

This PR is the readability fix alone. PR 2 (`cursor/adset-location-multi-city`)
changes the model.

## Scope / files

- `lib/wizard/adset-suggestions.ts`: `shortLocationLabel` (badge text:
  place + radius, e.g. `Newcastle upon Tyne +200km`); `stampLocationGroup`
  (the per-group stamping `generateSuggestions` did inline, now with no name
  suffix); `reassignAdSetLocationGroup` (the per-row select, which now strips
  a legacy ` — {old label}` suffix so a moved row can't read London while its
  badge says Newcastle); the row's width classes as constants the tests assert
  on. `duplicateSuggestionsUnderLocationGroup` no longer appends a suffix and
  still strips a legacy one.
- `components/steps/budget-schedule.tsx`: the row uses those classes. The main
  row wraps, so the controls drop under the name before the name column goes
  below 14rem. The name input has an 8rem minimum. The location badge is
  `min-w-0 max-w-[9rem]` with a truncating inner span and the full label in
  `title`. No element moved, and the age / budget / Advantage+ / Placements
  controls are untouched.

## What does not change

- Stored data: `locationLabel` still holds the full label and persisted names
  are not rewritten on load. A name is only cleaned when the operator moves
  that row to another location or duplicates it under a new group.
- Single-location campaigns: no badge and no suffix, as before.

## Consequence to know before merge

The ad set `name` is exactly what `buildAdSetPayload` sends to Meta. Without
the suffix, a campaign generated with two location groups sends pairs of ad
sets with the same name ("Similar Pages" twice) to Ads Manager, told apart
only by targeting. PR 2 makes combined cities the default (one ad set per
audience), which removes most of these pairs. Its **Split by city** action is
where per-city names come back.

## Validation

- [x] `npx tsc --noEmit`: no errors in touched files (the pre-existing errors
  in unrelated `__tests__` files are unchanged)
- [x] `npm run build`
- [x] `npm test`: 6092 pass, 0 fail
- New: `lib/wizard/__tests__/adset-row-location-label.test.ts`
