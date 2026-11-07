# Session log template

## PR

- **Number:** 1099
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1099
- **Branch:** `cursor/learning-copy-library`

## Summary

Score each ad line against the event it ran in, and keep that library operator-only. The normaliser turns a line into a template. The learning refresh writes `copy_performance` (migration 207, not applied). Readers sit behind `requireOperator()`.

## Scope / files

- `lib/learning/copy/normalise.ts`, `lib/learning/copy/score.ts`
- `lib/learning/copy-performance.ts` and the fifth job in `lib/learning/runner.ts`
- `lib/learning/cross-client/` (`server-only`, `OperatorContext`)
- `supabase/migrations/207_copy_performance.sql` (written, not applied)
- Guard and scoring tests

## Validation

- [x] `npm test` (7696 pass, 4 skipped, vitest 8 pass)
- [x] `npm run build`
- [x] Read-only `scripts/learning-refresh.mts --dry-run` (no writes, migration not applied)

## Notes

Ops review: events_n counts real shows. A unique `[EVENT_CODE]` in the campaign name is the show, ahead of the draft link on `launched_ads` (the Jamie Jones signup draft is linked to the Colyn event). With no code, a campaign that names exactly one other show uses that show (`[20261204CSA] Woraklis` is linked to Colyn; the Worakls event has no code). Otherwise one ad belongs to the event it spent the most on. Same date and venue are one show. Cancelled events and events with no date are not shows, so `[IRWOHD]` Brand Awareness (Always-On) drops out. Name-only templates are dropped and counted on the run. A page that is not one of the client's promoter pages is an artist page, and the page id is stored.

Shrinkage constant k = 2. n is events and proven starts at 2 events, so the smallest proof weighs the same as the prior of 1. A 2-event line must be at 0.8 raw to shrink to 0.9. The old k of 10 was sized for ads; at 2 events it lifts a raw 0.5 to 0.92, so a two-event line could never be proven. The writer integration is a later PR. No UI.
