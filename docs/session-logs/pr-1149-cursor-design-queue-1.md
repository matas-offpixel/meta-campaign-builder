# Session log

## PR

- **Number:** 1149
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1149
- **Branch:** `cursor/design-queue-1`

## Summary

The 393 event header keeps an even gap between View client, Drive folder and Edit. The frame runner uses en-GB so a date input reads dd/mm/yyyy. AB5 mounts the live ladder on the seed, and the offer card names the operator.

## Scope / files

- `components/dashboard/events/event-detail-header.tsx` — the View client link no longer adds its own padding
- `scripts/plan-frames/run.mjs` — locale en-GB
- `components/dashboard/asset-bank/frame-mount.tsx` — AB5 uses `LiveLadder` with `defaultLadder()`
- `lib/releases/offers.ts` — the entered-by line, never a user id

## Validation

- [x] asset-bank tests
- [x] frames AB 42728954711 / 42728958447 and CLS 42728963403 / 42728967569, pairs at 0

## Notes

The extra space on the 393 row was the View client link's padding (8px), sitting in the flex gap beside the Drive button. The offer card already read "entered by Matas, 8 Nov"; the line now comes from the operator's name and refuses a user id. AB5 shows the seed's rungs, including 7 days on selling fast, rather than the static Puzzle drawing. The frame job generates en_GB.UTF-8; a page locale alone left the date input on mm/dd/yyyy.
