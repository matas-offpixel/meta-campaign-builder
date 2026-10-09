# Session log — MML wizard shell

## PR

- **Number:** 1052
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1052
- **Branch:** `cursor/mml-wizard-shell`

## Summary

The operator plan page is the campaign creator's stepped wizard. Step 1 names the client and each channel's accounts. Step 5 is the Meta creatives step. The intake grid is gone from the page. The 193 tables and `lib/plan/creative-intake*` stay.

## Scope / files

- `components/wizard/mml-wizard.tsx` — eight-step shell (stepper, footer, blockers). Steps 4, 6 and 7 mount the Meta audiences, budget and assign steps. Step 8 is the plan's paused launch. `?drawer=` selects the step and channel.
- `components/wizard/mml-step-client.tsx` — client, channel cards, and named identities.
- `lib/plan/mml-wizard.ts`, `lib/plan/channel-history.ts`, `app/api/plan/channel-history/route.ts` — step list, deep links, most-used history.
- `components/plan/plan-workspace.tsx` — operator renders the wizard. The share page keeps the canvas, without the intake.
- Share still uses the canvas. Objective, optimisation, the TikTok creatives expander, and the budget split are later rounds.

## Validation

- [x] `npx tsc --noEmit` — 346 errors, none in the touched files
- [x] `npm run build`
- [x] `npm test` — node 7292 tests, 7288 pass, 4 skipped; vitest 8/8
- [x] ESLint on the touched wizard files
- [x] Folamour `/mml/8d70f724-ce3b-428d-be63-b46e78ff057d`: step 1 shows NX Promoter, NX Newcastle Universe Pixel, Page Puzzle, Instagram @puzzleofficialuk (photo), TikTok Electric Group, identity NX Loves (photo). Step 5 is the Meta creatives step (Grid and Story).

## Notes

The Facebook Page picture comes from the ad account's Page list. Puzzle is not on that list, so step 1 shows the name from page identity with an initial.

Unreachable after the intake left the page. Left in place, with the 193 tables:

- `components/plan/mml-creative-intake.tsx` — nothing imports it
- `app/api/plan/[id]/creative-intake/route.ts` — only that component called it
- `lib/plan/creative-intake-server.ts` — only that route imports it
- `lib/plan/creative-intake-meta.ts` — only the server module imports it

`lib/plan/creative-intake.ts`, `creative-intake-apply.ts` and `creative-intake-db.ts` are still used by plan copy.
