## PR

- **Number:** 228
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/228
- **Branch:** `creator/motion-replacement-tag-reporting`

## Summary

Adds creative-tag performance breakdowns to public share active-creative sections and the internal event active-creatives panel, computed at render time from existing active-creatives snapshot payloads plus fresh `creative_tag_assignments` reads.

## Scope / files

- `lib/reporting/creative-tag-breakdowns.ts` builds weighted tag breakdown rows from concept groups and assignments.
- `lib/db/creative-tags.ts` reads assignment tags in batch and normalises joined taxonomy rows.
- `components/share/share-creative-tag-breakdowns.tsx` renders reusable brand/ticketed breakdown tables.
- `app/share/report/[token]/page.tsx` loads share assignments alongside active-creatives data.
- `components/dashboard/events/event-active-creatives-panel.tsx` and `app/api/insights/event/[id]/tag-breakdowns/route.ts` add internal panel parity.

## Validation

- [x] `npm test`
- [x] `npm run lint -- lib/reporting/creative-tag-breakdowns.ts lib/reporting/__tests__/creative-tag-breakdowns.test.ts lib/db/creative-tags.ts components/share/share-creative-tag-breakdowns.tsx components/share/share-active-creatives-section.tsx components/dashboard/events/event-active-creatives-panel.tsx app/api/insights/event/[id]/tag-breakdowns/route.ts`
- [x] `npx tsc --noEmit`

## Notes

The breakdown matcher strips leading `[event_code]` prefixes when comparing seeded Motion assignment names with active creative ad names, preserving PR 1's canonical assignment names while matching live/snapshot rows.
