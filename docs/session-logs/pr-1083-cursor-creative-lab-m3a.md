# Session log

## PR

- **Number:** 1083
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1083
- **Branch:** `cursor/creative-lab-m3a`

## Summary

Creative Lab M3a writes captions, builds a Meta round, and queues the renders. Nothing is sent to Meta. The launch killswitch and the event card are M3b, after this merges.

## Scope / files

- Migration `200_creative_lab_m3.sql` (not applied as a file): wider caption styles, primary text, declared names, size variant, style settings, round target columns, `launch_state`, render `attempt`, `creative_lab_event_facts.headliners`.
- `lib/creative-lab/writer.ts`, `corpus.ts`, `upcoming.ts`, `propose.ts`, `render-queue.ts`, and the validator split in `caption-facts.ts`.
- Cron `GET /api/cron/creative-lab-render-tick` every minute.
- Long caption size in `v1.json` (`longApproved: false`). Side-by-side: `docs/creative-lab/long-size-side-by-side.png`.
- Corpus markdown committed with `lib/creative-lab/corpus.ts`.

## Validation

- [x] `npm test` — 7569 passed, 4 skipped, plus 8 vitest
- [x] `npm run build` — passed (the pre-existing `config` warning on the reel route is unchanged)
- [x] ESLint on the Creative Lab files — no errors
- [x] `npx tsc --noEmit` — no errors in the Creative Lab files. The repo-wide run still fails in unrelated tests that were already failing.

## Notes

- Migration 200 is unapplied. Caption inserts need it. The rights refusal does not.
- `longApproved` is false and is left out of `styleVersion()`. The long size numbers are in the hash, so the version is now `4a9ddd841764b7a5296f522081afc7af816fd6dabc87a0c869f43c55f94e69e5`. Captions stamped with the previous hash will not re-render until they are restamped. This PR does not restamp them.
- No long overlay was found to measure. The long size is 0.75× the locked default: up to 5 lines of 24, stroke the same fraction of the em. The sign-off sentence "Prospa at NX last season. This season: Interplanetary Criminal, Schak, East End Dubs and more." is 94 characters, wraps to 5 lines at 24, and passes. Five lines at the caption centre stay inside the 4:5 safe rectangle. The PNG is re-rendered. Matas flips `longApproved` after looking at it.
- `/admin/cron-health` watches snapshot-table freshness and `CRON_ALARMS`. `creative-lab-render-tick` is in neither, so a missing minute is not a failure. The tick writes a `cron_runs` row only when it claimed a render, timed one out, or failed. A throw still records. A 401 still does not.
- Page and Instagram actor are read from the draft that launched the ad set. They are not columns on `launched_ads`.
- Lambda function `remotion-render-4-0-471-mem2048mb-disk2048mb-480sec` is deployed. The serve URL is unchanged. The 240s function is still in the account and is not selected.
- Luke Dean's existing artist row now has `rights_doc_ref` `PENDING: Luke Dean team` and `approved_at` null. `proposeRound` for P26-BDAY refused with `not_approved` before any round row was written.
- The first generate (signup voice, umbrella event) is superseded by the sale-stage and headliner rules below. Those rows were not inserted.
- `events.status` is still `upcoming` for P26-BDAY, P26-BDAY-DAY and P26-BDAY-NIGHT. It was not changed. The preview passed `stageOverride: 'on_sale'` because the record lags.
- Headliners for P26-BDAY-DAY only, in the preview database: Enzo Siragusa, Luke Dean, Reeshy. The column was added there so the row could be written; migration 200 still carries the same `add column if not exists`, and the rest of that file is unapplied. Part 2 has no facts row.
- The captions below were generated for P26-BDAY-DAY and kept only when the validator passed. They were not inserted.

Lineup, validator passed. None name Phill de Janeiro or Benji King:

1. Overlay `Luke Dean closing / out Circuit / for Puzzle / 4th Birthday`. Primary `Who's coming? 🎟 Tickets on sale now`. Size `default`.
2. Overlay `Enzo Siragusa, / Luke Dean, Reeshy & more / are taking over Circuit / for Puzzle 4th Birthday`. Primary `Who's coming with? 🎶 Tickets on sale now`. Size `long`.
3. Overlay `POV: Luke Dean is / playing Puzzle / 4th Birthday / at Circuit`. Primary `Grab yours 🎫`. Size `default`.

What's next, validator passed. The Next list is the headliners:

1. Overlay `Same room. Next: / Enzo Siragusa, / Luke Dean, Reeshy`. Primary `Tickets on sale now 🎟️`. Size `default`.
2. Overlay `Pick one: Next: / Enzo Siragusa, / Luke Dean, Reeshy`. Primary `Grab yours 🎟️`. Size `default`.
3. Overlay `We started / something. Next: / Enzo Siragusa, / Luke Dean, Reeshy`. Primary `Who's coming? 👀`. Size `default`.

POV, validator passed:

1. Overlay `POV: Luke Dean / just dropped / the first track / at Circuit`. Primary `Who's coming? 👀`. Size `default`.
2. Overlay `POV: you / finally made / it to Puzzle's / 4th Birthday`. Primary `Tickets on sale now 🔊`. Size `default`.

P26-BDAY-NIGHT refused with `no event facts`.
Scarcity attempt `Final tickets. Selling fast.` rejected: `scarcity_without_tiers` — the event has no ticket tiers. Puzzle's Skiddle feed has no numbers.

The earlier rights check still stands: `proposeRound` for Luke Dean refused with `not_approved` before any round row was written.
