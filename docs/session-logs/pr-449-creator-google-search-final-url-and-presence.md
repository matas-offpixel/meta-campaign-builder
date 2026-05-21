# Session log — Google Search final URL + Presence geo (Phase 5b)

## PR

- **Number:** 449
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/449
- **Branch:** `creator/google-search-final-url-and-presence` (stacked on #448)

## Summary

Closes the two last LWE smoke-test gaps before the first real client push:

1. **RSA final URL** — Google Ads rejects `adGroupAds:mutate` without
   `finalUrls`. The xlsx parser now extracts the plan-level URL from
   the Ad Copy metadata row (e.g. `Final URL: https://www.seetickets.com/event/...`),
   applies it to every RSA, and emits `missing_final_url` when nothing
   is found. The wizard's Plan Setup step gets a prominent "Default
   final URL" input that overwrites every RSA's `final_url` in one
   keystroke (matches the J2 plan's "one SeeTickets URL for every
   RSA" pattern). Review hard-blocks pushes when any RSA has a null
   or non-http(s) URL; soft-warns on http://. The push adapter
   pre-filters URL-blocked RSAs into the partial-failure bucket with
   a clear message so a stale tab can't slip a bad RSA through.
2. **Presence geo-targeting default** — campaigns now create with
   `geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE", negativeGeoTargetType: "PRESENCE" }`
   so we only target people physically in / regularly in the
   location. The Targeting & Budget step gets a two-option toggle
   defaulting to Presence; an `interest` choice flips
   `positiveGeoTargetType` to `PRESENCE_OR_INTEREST`. The setting
   persists into the existing `google_search_plans.geo_targets` jsonb
   column via a wrapper-object form — **no migration**. Legacy rows
   (pre-Phase 5) read as Presence and upgrade in place on next save.

## Scope / files

### New
- `lib/google-search/geo-targets-codec.ts` — parse/serialize for the
  in-memory `(geo_targets[], geo_target_type)` pair ↔ the on-disk
  `geo_targets jsonb` column. Accepts both legacy-array and Phase-5
  wrapping-object forms; always writes the new form.
- `lib/google-search/final-url-state.ts` — pure helpers used by Plan
  Setup, Review validation, and the push adapter:
  `collectPlanFinalUrlState`, `isValidLandingUrl`, `isPushableRsa`,
  `finalUrlBlockReason`.

### Modified
- `lib/google-search/types.ts` — added `GoogleSearchGeoTargetType`
  + `geo_target_type` on `GoogleSearchPlan`; added warning code
  `missing_final_url`.
- `lib/google-search/xlsx-import.ts` — `extractFinalUrlFromTab` scans
  pre-header rows of Ad Copy (fallback to Overview) for an
  `https?://` URL, strips trailing punctuation, and the parser
  assigns it to every RSA. New plans default
  `geo_target_type: "PRESENCE"`.
- `lib/google-search/tree-mutations.ts` — added
  `setPlanDefaultFinalUrl` (overwrite) and
  `setPlanDefaultFinalUrlIfBlank` (gap-fill).
- `lib/google-search/validation.ts` — three new RSA validations:
  `rsa_final_url_missing` (error), `rsa_final_url_invalid` (error,
  not http/https), `rsa_final_url_http` (warning, prefer https).
- `lib/db/google-search-plans.ts` — `hydratePlan` centralises the
  jsonb codec; create + save use `serializeGeoTargetsColumn`;
  `geo_target_type` round-trips through create/load/save.
- `lib/google-ads/campaign-writer.ts` — `buildCampaignOp` now takes
  `geoTargetType` (default PRESENCE) and emits
  `geoTargetTypeSetting`; `pushAdGroupRsas` pre-filters URL-blocked
  RSAs into `summary.rsasFailed` and only calls `adGroupAds:mutate`
  when pushable RSAs remain.
- `components/google-search-wizard/steps/plan-setup.tsx` — new
  "Default final URL" card with shared/mixed/missing/http counts.
- `components/google-search-wizard/steps/targeting-budget.tsx` — new
  "Location targeting" card with a Presence / Presence-or-Interest
  toggle (Presence is the default, badged Recommended).
- `components/google-search-wizard/steps/review.tsx` — new RSA URL
  codes route fix-button back to Ad Copy (step 4).
- 4 existing test fixtures gained `geo_target_type: "PRESENCE"`.

### Tests (added)
- `lib/google-search/__tests__/geo-targets-codec.test.ts` — 9 cases
  covering legacy-array decode, Phase-5 wrapping-object decode,
  garbage tolerance, round-trip, in-place upgrade.
- `lib/google-search/__tests__/final-url-state.test.ts` — 13 cases
  covering `isValidLandingUrl`, `collectPlanFinalUrlState` (shared
  vs mixed, missing/invalid/http counts), `isPushableRsa`,
  `finalUrlBlockReason`.
- `lib/google-search/__tests__/xlsx-import.test.ts` — extended with
  `extractFinalUrlFromTab` cases and an end-to-end
  `Final URL plumbing` suite (propagation to every RSA, missing
  warning + null RSA, default PRESENCE plan).
- `lib/google-search/__tests__/validation.test.ts` — extended with
  `validateGoogleSearchPlan — RSA final URL` (missing → hard error,
  invalid → hard error, http:// → warning, https://valid → clean).
- `lib/google-ads/__tests__/campaign-writer.test.ts` — extended with
  `geoTargetTypeSetting` (default PRESENCE + interest override) and
  `RSA final URL guard` (valid URL pushes, null URL skips mutate +
  partial-fails, invalid URL skips the bad RSA but pushes the rest).

## Validation

- [x] `npx tsc --noEmit` — 46 errors total, parity with main; none in
  `lib/google-search/**`, `lib/google-ads/**`, or
  `components/google-search-wizard/**`.
- [x] `npx eslint lib/google-search/ lib/google-ads/ components/google-search-wizard/ lib/db/google-search-plans.ts`
  — clean (one pre-existing `_opts` unused-var warning).
- [x] `node --experimental-strip-types --test 'lib/google-search/__tests__/*.test.ts' 'lib/google-ads/__tests__/*.test.ts' 'lib/db/__tests__/google-search-plans-save.test.ts'`
  — 151/151 pass (was 118; added 33 new assertions for Phase 5b).
- [x] `npm run build` — clean.

## Notes / open questions

- **v0 gap (documented for follow-up):** the push adapter sets the
  `geoTargetTypeSetting` on the campaign but does NOT yet push the
  per-location `campaignCriterion` rows (the `geo_targets` array of
  London +20%, South East +15%, etc). Without those criteria the
  account default geo target list is used. The Presence/Interest
  setting still applies to whatever ends up targeted, so this fix is
  still valuable — but the bid-modifier per location is a separate
  campaign-criterion mutate that we haven't built yet. Next PR
  candidate: `creator/google-search-geo-location-criteria`.
- **Per-campaign final URL:** the plan-level default applies to every
  RSA at parse + Plan Setup time, and the Ad Copy step's existing
  per-RSA `Final URL` input lets the operator override individually.
  Per-RSA overrides survive autosave (RSA row carries `final_url`).
  Per-campaign defaults are a future nicety if Matas ever runs an
  event with multiple landing pages.
- **The legacy `geo_targets` jsonb shape:** older plans persist as a
  plain array; `parseGeoTargetsColumn` decodes them as
  `{ targets, geo_target_type: "PRESENCE" }`. Re-saves write the
  Phase-5 wrapping object, upgrading rows in place. Reverting this
  PR is safe — readers tolerate both shapes.

## After merge

Matas re-imports J2 on the LWE account:
1. Confirm the SeeTickets URL populates every RSA in Plan Setup.
2. Confirm Targeting & Budget defaults to Presence.
3. Bulk-set £1/day (PR #448) → push (PAUSED) → verify in Google Ads:
   - Each campaign has `Location options → People in or regularly
     in your targeted locations`.
   - Each RSA has the SeeTickets URL as its Final URL.

That closes the LWE smoke-test gate. The next real bug surfaces
after Matas enables one of the campaigns and lets it run for ~24h.
