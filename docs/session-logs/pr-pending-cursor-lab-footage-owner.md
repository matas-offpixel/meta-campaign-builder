# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/lab-footage-owner`

## Summary

Promoter copy pairs only with the promoter's own footage, and an Artist caption or a quote pairs only with that artist's clips (plus promoter clips that feature them). Generated first person is no longer written.

## Scope / files

- `supabase/migrations/226_creative_lab_footage_owner.sql` (written, not applied)
- `lib/creative-lab/footage-owner.ts` and the import, pairing, and round paths
- Creative Lab clips, captions, and the event page
- `scripts/lab-unpair-crossed.mts`
- Frames CLW1–CLW3; CLV1 and CLV4 re-baselined

## Validation

- [x] unit tests for owner, pairing, and propose
- [x] dry run: 11 Puzzle Lineup captions unpaired, 0 others, 0 first-person retired
- [ ] frames on Ubuntu
- [ ] CI

## Notes

Migration 226 is not applied. The dry run did not write. The design-pass label is not added.
