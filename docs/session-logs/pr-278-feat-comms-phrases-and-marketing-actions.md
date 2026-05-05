## PR

- **Number:** 278
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/278
- **Branch:** `feat/comms-phrases-and-marketing-actions`

## Summary

Adds dashboard comms phrase generation and marketing action recommendations so operators can copy sales-state language and see the next suggested move directly from venue/event/tier reporting.

## Scope / files

- `lib/dashboard/comms-phrase.ts` for suggested percent to copy phrase mapping.
- `lib/dashboard/marketing-actions.ts` for pure event/tier recommendation logic.
- `components/dashboard/events/ticket-tiers-section.tsx` for tier-level comms chips.
- `components/share/venue-event-breakdown.tsx` for event comms, venue aggregate suggested/comms, and recommended action panels.
- `components/share/client-portal-venue-table.tsx` for venue-card suggested/comms and share-view advisory breakdown wiring.

## Validation

- [x] `npx tsc --noEmit`
- [ ] `npm run build` (when applicable)
- [x] `node --experimental-strip-types --test 'lib/dashboard/__tests__/suggested-pct.test.ts' 'lib/dashboard/__tests__/marketing-actions.test.ts'`
- [x] `npm run lint -- components/dashboard/events/copy-to-clipboard.tsx components/dashboard/events/ticket-tiers-section.tsx components/share/venue-event-breakdown.tsx components/share/client-portal-venue-table.tsx lib/dashboard/comms-phrase.ts lib/dashboard/marketing-actions.ts lib/dashboard/__tests__/suggested-pct.test.ts lib/dashboard/__tests__/marketing-actions.test.ts`

## Notes

The feature work was isolated in `/Users/liebus/meta-campaign-builder-comms-phrases` because the primary checkout had unrelated dirty motion/tagger changes.
