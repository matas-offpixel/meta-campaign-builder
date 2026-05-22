# Session log — 8 default sitelinks (crowd-out)

## PR

- **Number:** 458
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/458
- **Branch:** `creator/google-search-sitelinks-crowd-out`

## Summary

Bumped the auto-seeded default sitelink count from 4 to 8 to implement a crowd-out
strategy against pre-existing account-level sitelinks.  Google Ads API v23 provides
no per-campaign mechanism to disable account-level sitelink inheritance (documented
in PR #456).  The crowd-out approach instead relies on the fact that Google shows
≤6 sitelinks per ad impression and prefers campaign-level over account-level ones —
supplying 8 campaign-level sitelinks fills every display slot, so the wrong
account-level sitelinks (LWE "What's On" / "About Us" etc.) never surface.

New defaults added: Set Times, Travel & Parking, The Stages, How to Buy.  A new
`sitelinks_below_crowd_out` soft warning fires when a plan has ≥2 but <6 sitelinks,
informing operators of the threshold.  The launch-summary warning was updated to
mention the crowd-out approach as an alternative to manual removal.  The preflight
checklist was extended with a Sitelinks section.

## Scope / files

- `lib/google-search/sitelink-defaults.ts` — extended from 4 → 8 defaults
- `lib/google-search/types.ts` — added `RECOMMENDED_CROWD_OUT_SITELINKS: 6` constant
- `lib/google-search/validation.ts` — added `sitelinks_below_crowd_out` soft warning
- `lib/google-ads/campaign-writer.ts` — updated account-level sitelink warning copy
- `docs/GOOGLE_SEARCH_PLAN_PREFLIGHT_CHECKLIST.md` — new Sitelinks section
- `lib/google-search/__tests__/sitelinks.test.ts` — updated + new tests (16 total)

## Validation

- [x] `npx tsc --noEmit` — zero errors in our files (pre-existing errors in
  `lib/audiences/` and `lib/dashboard/` are unrelated and pre-date this branch)
- [x] `npx eslint lib/google-search/ components/google-search-wizard/` — 0 errors,
  2 pre-existing warnings in unrelated files
- [x] `node --experimental-strip-types --test 'lib/google-search/__tests__/*.test.ts'`
  — 148 pass, 0 fail
- [ ] `npm run build` — deferred (no API/component changes, no new routes)

## Notes

- All 8 default link_texts are verified ≤25 chars; all description lines ≤35 chars
  by the test suite (`all 8 default link_texts within 25-char limit`).
- Existing plans seeded with 4 sitelinks (pre-#456 imports) are not retroactively
  updated — operator adds 4 more in the Ad Copy wizard step and re-pushes, or
  re-imports the XLSX.
- `RECOMMENDED_CROWD_OUT_SITELINKS = 6` is the lower bound for crowd-out; the wizard
  seeds 8 so new plans are well above the threshold with room to trim 2 if desired.
