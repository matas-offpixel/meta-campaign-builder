## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/lab-generate-live-fix`

## Summary

Generate wrote nothing because the promoter voice read filtered `artist_id` with `.eq(null)`. PostgREST sent the string `"null"`, and the uuid column rejected it before the writer ran. The read uses `.is(null)`, and the generate route logs one line per call.

## Scope / files

- `lib/creative-lab/voice-store.ts`
- `lib/creative-lab/generate-log.ts`
- `lib/creative-lab/card-write.ts`
- `app/api/creative-lab/events/[eventId]/route.ts`
- `lib/creative-lab/__tests__/generate-live.test.ts`
- `lib/creative-lab/__tests__/fake-db.ts`

## Validation

- [x] `npm test`
- [x] `npm run build`
- [ ] `frames:check` — no frame moved; none re-shot

## Notes

Migration: none. Reproduced read-only against Puzzle 4th Birthday (`a092aca8-7d9d-4ccd-9eb8-1ada0a62d3d8`): the voice read threw `invalid input syntax for type uuid: "null"`. After the fix, Each selected (2 clips) returned 2 captions and inserted nothing. The log line is `event`, `mode`, `clips`, `writerResultCount`, `errorClass`.
