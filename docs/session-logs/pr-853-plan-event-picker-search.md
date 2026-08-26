# Session log

## PR

- **Number:** 853
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/853
- **Branch:** `cursor/plan-event-picker-search`

## Summary

The /plan event picker was a native `<select>` over every event, labelled by name only — so tour repeats like “England - Last 8” were indistinguishable. Reuses `components/ui/combobox.tsx` with type-to-filter, client · venue · date secondary lines, upcoming-only default, and a Show past events toggle. Saved past `event_id`s still resolve. Event rows are not archived.

## Scope / files

- `lib/plan/event-picker.ts` — labels, filter, sort
- `lib/plan/__tests__/event-picker.test.ts`
- `components/plan/plan-workspace.tsx` — Combobox + toggle
- `app/(dashboard)/plan/[id]/page.tsx` — load date/venue/code/client name
- `components/ui/combobox.tsx` — additive `keywords` + selected sublabel in trigger

## Validation

- [x] eslint on touched files
- [x] `npm test` — 4481 tests, 1111 suites, 4478 pass, 0 fail, 3 skipped
- [x] `npm run build`

## Notes

### Inventory

Page loaded `events.id, name, client_id` only and joined clients for ad-account ids, not names. Duplicate names are the same tour/show title reused across venues and dates (and brand rows with no date). `events` already has `event_date`, `event_code`, `venue_name`, `venue_city`, `kind`.

### Filter / sort

Upcoming (`event_date >= today` Europe/London) soonest first, then undated (always visible), then past most-recent first when the toggle is on. Selected past `event_id` is pinned into the list when the toggle is off.
