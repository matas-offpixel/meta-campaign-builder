[Use Opus]

# TikTok and Google Search account pickers become searchable, using the Combobox #973 gave Meta. One PR, `cursor/searchable-selects-tiktok-google`, off fresh `main`. Open, don't merge.

#973 replaced the Meta ad-account and pixel `<select>`s with `components/ui/combobox` (`components/steps/account-setup.tsx:309,373`, `campaign-setup.tsx:550`, `creatives.tsx:848,1273`) with `lib/meta/account-picker-options.ts` supplying `{ value, label, keywords }` rows and the `UNNAMED_ACCOUNT_LABEL` fallback. The TikTok and Google Search surfaces still use plain selects, and Matas scrolls through dozens of advertisers on each.

## Swap these

- `components/tiktok-wizard/steps/account-setup.tsx` — `<Select id="tiktok-advertiser">` (:429) and `<Select label="TikTok pixel">` (:537). Identity, optimisation-event, and manual-* fields stay as they are; they are short enums, not account lists.
- `components/google-search/plan-actions.tsx` — the three `<select>`s at :94/:109/:124: linked event, Google Ads account (customer id), and whatever the third is (say in the PR body). The event one only if it lists more than a handful; if it's short, leave it and say so.
- The TikTok and Google standalone-page equivalents if the drawers (`components/plan/tiktok-drawer.tsx`, `google-drawer.tsx`) mount a different picker — grep for the same ids and swap those too, so the two routes stay identical.

Rows come from a sibling of `account-picker-options.ts` per platform (`lib/tiktok/account-picker-options.ts`, `lib/google-ads/account-picker-options.ts`), same shape: `value` is the id the draft stores today (TikTok `advertiser_id` string; Google customer id in whatever form the draft already holds — do not reformat it), `label` is name + id, `keywords` includes the id with and without dashes so `3337038088` and `333-703-8088` both match. Unnamed → the same `UNNAMED_ACCOUNT_LABEL` pattern, not blank.

## Guards

No migration. The stored value on the draft is byte-identical to today — assert it. No change to `lib/tiktok/write/**`, `lib/google-ads/campaign-writer.ts`, or any launch/push path. Do not touch `lib/optimisation/**`, `lib/google-search/**` beyond the picker component.

## Test plan

Options builder: name+id label, dashed and undashed id both in keywords, unnamed fallback. Selecting a TikTok advertiser stores the same `tiktokAccountId` the old select stored (golden on the draft field). Same for the Google customer id. Typing "333" narrows to the MCC. Existing account-setup tests green.

Full `npm test`, `npm run build`, check-run conclusions in the thread — not in a commit.
