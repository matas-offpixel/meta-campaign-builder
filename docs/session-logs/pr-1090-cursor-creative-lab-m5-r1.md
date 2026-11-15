# Session log

## PR

- **Number:** 1090
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1090
- **Branch:** `cursor/creative-lab-m5-r1`

## Summary

Creative Lab's lineup is the event roster. An @ search picks a library artist, or a Spotify artist which is saved into the library first. Saving writes `event_artists`, then the facts arrays the captions already read. Clearance stays one row per client and library artist. The next-step strip replaces the facts form. Payday moves to the event header. Ticketing leaves Overview: a link to the client Ticketing tab, and tickets sold on Reporting.

## Scope / files

- `components/dashboard/events/creative-lab/strip.tsx`, `lineup.tsx` — the four-step strip and the lineup rows
- `components/dashboard/events/creative-lab-card.tsx` — facts text areas and the artist name field removed; clips, captions and rounds stay
- `components/dashboard/events/event-detail.tsx` — payday on the header; roster panel off Overview; ticketing link; tickets sold on Reporting
- `lib/creative-lab/lineup.ts`, `lib/db/creative-lab.ts`, `lib/creative-lab/caption-facts.ts`
- `app/api/creative-lab/events/[eventId]/route.ts`, `app/api/events/[id]/artists/route.ts`
- `supabase/migrations/205_creative_lab_artist_link.sql` — written, not applied
- `scripts/creative-lab-backfill-lineup.mts` — dry-run by default

## Validation

- [x] `npx tsc --noEmit` — no errors in the files this change touches. The repo still has older errors elsewhere.
- [x] `npm run build`
- [x] `npm test` — 7636 passed, 0 failed, 4 skipped; vitest passed
- [x] ESLint on the touched files
- [x] Backfill dry-run against production. `--apply` was not run.

## Notes

Migration 205 is not applied. Until it is, marking a lineup artist cleared returns "The lineup link isn't available until the database update is applied." Reads do not use the new column, so the event page still loads.

The library has no artists, and `event_artists` for Puzzle 4th Birthday is empty. The page shows an empty lineup until `scripts/creative-lab-backfill-lineup.mts --apply` runs after the migration. Enzo Siragusa and Luke Dean already have Lab rows; the dry-run plans to link those two and to create all five library artists. It does not touch Part 1 or Part 2.

Find clips stays on a lineup row once that artist is on the lineup and cleared. Clips already imported still show in the clips section.

No operator session was available, so there are no screenshots of Puzzle 4th Birthday at 1280 or 393.

Dry-run:

```json
{
  "apply": false,
  "event": "Puzzle 4th Birthday",
  "eventCode": "P26-BDAY",
  "plan": {
    "eventId": "a092aca8-7d9d-4ccd-9eb8-1ada0a62d3d8",
    "createArtists": ["Enzo Siragusa", "Luke Dean", "Reeshy", "Phill de Janeiro", "Benji King"],
    "rows": [
      { "name": "Enzo Siragusa", "billingOrder": 1, "isHeadliner": true, "artistId": null, "create": true },
      { "name": "Luke Dean", "billingOrder": 2, "isHeadliner": true, "artistId": null, "create": true },
      { "name": "Reeshy", "billingOrder": 3, "isHeadliner": true, "artistId": null, "create": true },
      { "name": "Phill de Janeiro", "billingOrder": 4, "isHeadliner": false, "artistId": null, "create": true },
      { "name": "Benji King", "billingOrder": 5, "isHeadliner": false, "artistId": null, "create": true }
    ],
    "links": [
      { "labArtistId": "fe3736d8-4252-4282-bb32-de1e3fdfb359", "name": "Luke Dean" },
      { "labArtistId": "7bc3e3fa-b4e2-4b99-bc92-f76f9da04365", "name": "Enzo Siragusa" }
    ]
  }
}
```
