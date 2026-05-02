## PR

- **Number:** 245
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/245
- **Branch:** `creator/patterns-fix-tag-embed-and-debug-logging`

## Summary

Adds an explicit PostgREST foreign-key hint to the cross-event creative pattern tag embed and logs enough row-level diagnostics to confirm whether tags, snapshots, and rollups line up in production.

## Scope / files

- `lib/reporting/creative-patterns-cross-event.ts`
  - Uses `creative_tags!creative_tag_assignments_tag_id_fkey(...)` for assignment tag embedding.
  - Logs `[creative-patterns] tag-embed` with total/populated assignment tag counts and a sample row.
  - Logs `[creative-patterns] snapshot-loop` per snapshot before the rollup gate with payload kind, group count, rollup membership, and assignment count for the event.

## Validation

- [x] `npm run lint -- lib/reporting/creative-patterns-cross-event.ts`
- [x] `npx tsc --noEmit`

## Notes

Schema verification: migration `061_creative_tags_schema.sql` declares `creative_tag_assignments.tag_id references creative_tags`, which Postgres names `creative_tag_assignments_tag_id_fkey` by default.
