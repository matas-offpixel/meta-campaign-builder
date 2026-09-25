# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/creative-name-from-filename`

## Summary

Uploaded creatives take their name from the file. One helper strips the extension, leaves the operator's separators, and caps the name below Meta's 400-character ad-name limit (the lower of Meta 400 and TikTok 512). The plan canvas, the TikTok wizard, and the Meta creator all use it. A typed base name is left alone. Existing drafts are not renamed on load.

## Scope / files

- `lib/creative-name-from-filename.ts` — shared rule
- `lib/tiktok-wizard/creative-items.ts` — one base per uploaded file
- `lib/plan/asset-routing.ts` — canvas path calls the helper
- `lib/types.ts` — optional `Asset.fileName`
- `components/steps/creatives.tsx` — Meta upload sets `fileName` and names a still-default creative
- `lib/clients/asset-queue/queue-creative-bind.ts` — queue bind carries `fileName`

## Validation

- [x] `npm test` (6256 pass, 0 fail)
- [x] `npm run build`
- [ ] CI check-run conclusions (recorded in the thread, not here)

## Notes

Separators are not rewritten. A dual Meta creative bound with both aspects already present is named from the 4:5 slot, because that is the first slot `getAspectRatioSlots` creates. A later upload does not rename a creative that has already left `Ad N`.
