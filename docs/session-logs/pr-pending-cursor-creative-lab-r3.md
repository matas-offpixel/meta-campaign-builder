# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/creative-lab-r3`

## Summary

Clearance now gates artist-voice ads only. Uncleared artists still import, discover and run on the promoter Page. The event card follows design pass 3: one primary action per artist, a caption overlay on the clip, a feed post paired with a clip that can run, and a four-cell strip whose highlighted step is the one that needs you.

## Scope / files

- Rights: `lib/creative-lab/rounds.ts`, `propose.ts`, `launch.ts`, `clip-intake.ts`, `ig-discovery.ts`, `clip-sync.ts`, `surface.ts`
- Lineup, Spotify match and enrich: `lib/creative-lab/lineup.ts`, `spotify-match.ts`, `app/api/creative-lab/events/[eventId]/route.ts`, `scripts/creative-lab-spotify-enrich.mts`
- Card: `lib/db/creative-lab.ts`, `components/dashboard/events/creative-lab/**`, `creative-lab-card.tsx`, clip preview signing on the event page
- Design: `docs/creative-lab/design-rules.md`, `creative-lab-pass-2-2026-11-06.html`, `creative-lab-pass-3-2026-11-06.html`
- No migration. No production writes.

## Validation

- [x] `npx tsc --noEmit` on the touched files (full `tsc` still reports pre-existing errors outside this change)
- [x] `npm run build` (with `scripts/out` moved aside; that scratch folder is typechecked and already fails on `caption-outline-stills.mts`)
- [x] `npm test` — 7646 passed, 0 failed

## Notes

- Puzzle 4th Birthday already has `presale_at` and `general_sale_at`, so the sale-dates link stays off. The event-detail "Not set" rows were left as they are.
- The Spotify dry-run could not get a token. Production `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are sensitive and `vercel env run` will not pull them. All five Puzzle artists have no `spotify_id` and no photo. `--apply` is for Claude, after the credentials are available locally.
- No logged-in browser session, so the strip, lineup and clip tile were not opened at 1280 and 393. The caption overlay was screenshotted in headless Chrome beside `ugc1-side-by-side.png`.
