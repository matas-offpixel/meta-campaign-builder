# Session log — searchable TikTok and Google Search account pickers

## PR

- **Number:** 996
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/996
- **Branch:** `cursor/searchable-selects-tiktok-google`

## Summary

The TikTok advertiser and pixel pickers and the Google Search account and
linked-event pickers are now the `components/ui/combobox` Combobox that #973
gave Meta, so an operator can type a name or paste an id instead of
scrolling. Option rows come from per-platform siblings of
`lib/meta/account-picker-options.ts`. The value each picker stores on the
draft/plan is byte-identical to what the old `<select>` stored. No
migration.

## Swapped

- `components/tiktok-wizard/steps/account-setup.tsx`
  - `<Select id="tiktok-advertiser">` → Combobox. Mounted by both the
    standalone `/tiktok-campaign/[id]` wizard and the plan TikTok drawer
    (`components/plan/tiktok-drawer-details.tsx` renders the same
    `AccountSetupStep`), so there is one picker, not two.
  - `<Select id="tiktok-pixel">` (label "TikTok pixel") → Combobox.
- `components/google-search/plan-actions.tsx` (the `/google-ads` library
  header — "New plan" / "Import xlsx")
  - Linked event `<select>` → Combobox. Events are the user's `events`
    rows, capped at 200 by the page query; the busiest user in prod has 168.
    Not a short list, so it converts.
  - Ads account `<select>` → Combobox.
- `components/google-search-wizard/steps/plan-setup.tsx` — the drawer
  equivalent. The plan Google drawer (`components/plan/google-drawer-details.tsx`)
  and the standalone `/google-search/[id]` wizard both mount this
  `PlanSetupStep`, which has its own selects (not `plan-actions.tsx`).
  - `<Select id="gs-plan-event">` → Combobox (same event list as above).
  - `<Select id="gs-plan-account">` → Combobox. Its "Required before push."
    line is kept, rendered under the Combobox (Combobox has no `error` prop).

## Left as selects

- `plan-actions.tsx` third select: **Structure** (`structure_mode`),
  two options — "Single campaign ✓ (recommended)" / "Campaign per theme
  (legacy)". Short enum; left as a native `<select>`.
- `plan-setup.tsx`: Structure mode (`gs-plan-structure`) and Bidding
  strategy (`gs-plan-bidding`) — two-value enums.
- TikTok account setup: identity (radio list), manual identity type,
  optimisation event, manual pixel / identity inputs — short enums or free
  text, per scope.

## Option rows

- `lib/tiktok/account-picker-options.ts`
  - `tikTokAdvertiserPickerOptions` — value is the `tiktok_accounts` row id
    (what `tiktokAccountId` stores today; `advertiserId` is derived from it
    on save). Label `Name (advertiser_id)`. Keywords: name + advertiser id.
    Accounts without an advertiser id stay out, as before.
  - `tikTokPixelPickerOptions` — value `pixel_id`, label `Name (pixel_id)`,
    status as the sublabel (the trigger still reads `Name (id) · STATUS`).
  - `tikTokAdvertiserSelectionPatch` / `tikTokPixelSelectionPatch` — the
    `accountSetup` patches that used to be inline in `saveAccount` /
    `savePixel`, moved verbatim so a node test can pin them.
- `lib/google-ads/account-picker-options.ts`
  - `googleAdsAccountPickerOptions` — value is the `google_ads_accounts`
    row id (what `google_ads_account_id` stores today). Label
    `Name (customer id as stored)`; prod stores the dashed form
    (`333-703-8088`), and the label prints whatever is stored — not
    reformatted. Keywords: name, stored id, digits-only, and the dashed
    3-3-4 form, so `3337038088` and `333-703-8088` both match.
  - `googleSearchEventPickerOptions` — same labels and order as before
    (event date, newest first); keywords: name + event code.
  - `googlePickerStoredId` — `value || null`, the same assignment the
    select's `onChange` made.
- Unnamed rows read `Unnamed account` / `Unnamed pixel`. Nothing in
  `lib/tiktok` or `lib/google-ads` imports `lib/meta`, so the strings are
  copied with a comment that they match the Meta fallback; the tests
  assert equality with the Meta constants. The old Google fallback
  `"Account"` is replaced by `Unnamed account`.
- Account rows sort alphabetically, unnamed last (same as Meta). Events
  keep the caller's order.

## Stored ids unchanged

- TikTok: tests assert the patch for every advertiser row deep-equals the
  old inline `saveAccount` object, and the golden `tiktokAccountId` /
  `advertiserId` strings; the pixel patch golden is pinned too.
- Google: tests assert every account row value equals the old option
  value (`google_ads_accounts.id`), the MCC row stores its row id (not a
  customer id), and the empty row clears to `null`.
- `plan-actions.tsx` POST bodies (`event_id: eventId || null`,
  `google_ads_account_id: accountId || null`) are unchanged.

## Search

`"333"` narrows to the MCC (`Off/Pixel Manager Account`, `333-703-8088`)
and no other prod account. The tests use `pickerOptionMatches` from
`lib/meta/account-picker-options.ts`, the existing mirror of the Combobox
haystack (label + value + sublabel + keywords). The Combobox filter itself
is not exported and was not reimplemented. Combobox also matches on
`value` (row uuid); none of the five prod `google_ads_accounts.id`s
contain `333`.

## Not touched

`components/ui/**`, `lib/meta/**` (read only), `lib/tiktok/write/**`,
`lib/google-ads/campaign-writer.ts`, `lib/google-search/**`,
`lib/optimisation/**`, any launch/push route. No migration.

## Validation

- [x] `npx tsc --noEmit` — no errors in touched files; total error count
  identical with and without this change (all pre-existing, test files).
- [x] `npm run build`
- [x] `npm test`
- No live click-through was run.
