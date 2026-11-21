# Session log

## PR

- **Number:** 1160
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1160
- **Branch:** `cursor/claims-panel-ended`

## Summary

The Claims panel was still offering a release's "{release} live" rung after a later release had gone live. That rung is ended, not unmet, so the panel shows the next rung that can still come true and keeps a rung that already ran.

## Scope / files

- `lib/ticket-warnings/next-rung.ts` — `rungHasEnded` is the one test the panel and the AB2 locked card share. `claimPanel` lists done rungs, then the next open one.
- `components/dashboard/asset-bank/live.tsx`, `surface.tsx`, `frame-mount.tsx`
- `lib/db/releases.ts`, the event page — read settled warnings. No migration, no writes.
- AB1c at 1280 and 393. AB1, AB1b, AB2, AB3, AB4, AB5 and AB6 stay as on main.

## Validation

- [x] `node --experimental-strip-types --test lib/releases/__tests__/bank.test.ts` (34 pass)
- [x] `tsc --noEmit` on the touched files (only the pre-existing bank.test.ts TS2353)
- [x] Ubuntu pair 42863781446 / 42863793839, both 0 against each other. AB1c-1280 1280×562. AB1c-393 393×913. The other AB frames in the first artifact match the files on main.

## Notes

No design-pass label. Not merged.
