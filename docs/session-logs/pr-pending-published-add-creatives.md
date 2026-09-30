# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/published-add-creatives`

## Summary

Published rows get one Add to campaign button. It live-reads that Meta campaign by id and opens the wizard's existing Selected campaign block with the chip filled and both mode cards unselected. The operator picks Create new ad set or Attach ads to all existing ad sets there. Copy, CTA, URL and page/Instagram come from the published draft's first creative. Assets are not copied. The campaign stays in the selection; more campaigns can be added from the picker.

## Scope / files

- `lib/library/add-to-campaign.ts` — live decision, seed, wizard href with no mode query
- `app/api/meta/campaigns/[campaignId]/route.ts` — direct GET `/{campaignId}`
- `components/library/library-rows.tsx` and `campaign-library.tsx` — the button
- `components/steps/campaign-setup.tsx` — pending flag, locked chip, existing cards
- `components/wizard/wizard-shell.tsx` — opens on the campaign step
- `lib/validation.ts` — continue stays blocked until a card is picked
- `lib/meta/launch-error-classify.ts` — the #985 archived sentence, shared

## Validation

- [x] `npm test` — 6472 tests, 6468 pass, 4 skipped, 0 fail
- [x] `npm run build` — compiled in 17.1s, TypeScript in 36.3s. The only warning is the known `render-reel` `export const config`.
- [ ] CI check-run conclusions (reported in the thread, not committed)

## Notes

No migration. `attachSubmodePending` and `locked` live on the draft JSON.

No launch-route change. While the choice is pending, `wizardMode` stays `attach_campaign` so the existing Selected campaign block renders, and the pending flag keeps both cards unselected. Review aggregates that step and will not launch until a card is picked. A direct POST of a still-pending draft would follow `attach_campaign`, because that is the mode the launch route already understands.

No Meta token was available. The live Graph read was not executed against an ad account. Tests pass a fixture campaign, including an archived one, into the same decision the route uses.
