# Searchable Meta ad account and pixel pickers

## PR

- **Number:** 973
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/973
- **Branch:** `cursor/searchable-account-pickers`

## Summary

The Import from Meta dialog listed 25+ ad accounts in a native select, several of them bare numeric ids. Those Meta ad-account and pixel selects now use the existing Combobox. A shared row builder puts the name on the label, the id underneath, says "Unnamed account" when the name is just the id, keeps `(Read-Only)`, and sorts named accounts alphabetically with unnamed last. The saved value is still the account or pixel id.

## Scope / files

- `lib/meta/account-picker-options.ts` — row builder and the Combobox haystack check.
- `components/meta/meta-import-picker.tsx` — ad account select → Combobox. Read-only accounts stay in the list.
- `app/(dashboard)/audiences/[clientId]/clone-saved/clone-form.tsx` — both account pickers.
- `components/steps/account-setup.tsx` — pixel select → Combobox. The ad account picker was already a Combobox; its rows now use the same builder (currency and status stay on the sublabel).
- `components/audiences/source-picker.tsx` — pixel select. The pixel-event select stays.
- `components/intelligence/creative-heatmap.tsx` — already a Combobox; rows now use the same builder.

## Validation

- [x] `npm test` — 6220 pass, 0 fail
- [x] `npm run build`

## Notes

- No divider for a recently-used account. Combobox has no group slot, and this PR does not add persistence or change the shared primitive.
- Left on a plain select: client form id fields (typed ids, not a list), platform-accounts Meta row (status text), admin pixel form (typed id), bulk-attach (campaign and ad set checkboxes), pixel-event and other short selects, TikTok advertiser/pixel and Google Ads account selects (not Meta `act_` accounts).
