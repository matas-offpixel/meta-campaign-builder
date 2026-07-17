# Session log — main wizard step-4 BOOK_NOW hard block (PR B)

## PR

- **Number:** #723
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/723
- **Branch:** `cursor/creator/wizard-book-now-block-step-4`

## Summary

Closes task #93. The main wizard's Step 4 (Creatives) already showed an
inline "Can't launch: switch CTA to Buy Tickets..." warning banner
(`components/steps/creatives.tsx`) for a Dual/Full-mode creative using CTA
`BOOK_NOW`, but nothing actually blocked "Continue" or "Launch" — the
hard block from PR #574/#575/#719 was only ever wired into the bulk-attach
Configure Creatives surface, not the main wizard. Meta silently drops the
Feed (4:5/1:1) asset in this scenario (subcode 1885396) and cross-publishes
a single 9:16 asset to every placement instead — the live incident
(WC26 Bournemouth, 2026-07-10) that motivated the original bulk-attach fix.

## Root cause (recap from diagnosis)

`lib/validation.ts`'s `validateCreatives` (step 4) never called
`creativeHasBookNowMultiPlacementConflict` (from `lib/meta/creative.ts`,
added in PR #719). Since `wizard-shell.tsx`'s Continue/Launch buttons are
gated purely on `validateStep(step, draft).valid`
(`components/wizard/wizard-footer.tsx`: `disabled={!canContinue}` /
`disabled={!canContinue || launching}`), and step 7's `validateReview`
aggregates every visible step including step 4, wiring the check into
`validateCreatives` alone is sufficient — confirmed by reading the
call chain, no additional plumbing needed in `wizard-shell.tsx` or
`wizard-footer.tsx`.

## Scope / files

- `lib/validation.ts`:
  - `validateCreatives` now calls `creativeHasBookNowMultiPlacementConflict(c)`
    per creative and pushes a blocking error when it fires.
  - Also switched the file's four `./`-relative imports (`./types`,
    `./validation/page-instagram`, `./validation/asset-completeness`, and
    the new `./meta/creative`) to explicit `.ts` extensions
    (`allowImportingTsExtensions` is already on in `tsconfig.json`, and
    `lib/meta/client.ts` already uses this convention). This was required
    for `node --experimental-strip-types` (this repo's test runner) to
    resolve `./types` as the file `lib/types.ts` rather than the sibling
    `lib/types/` directory — the module previously could not be imported
    from any test at all, which is why no test suite had exercised it
    before this PR.
- `lib/__tests__/validate-creatives-book-now-block.test.ts` — **new**, 4
  cases: exact byte-diffed `errors` array for a Dual mode + BOOK_NOW
  creative, the same creative valid with CTA switched to Buy Tickets, the
  same creative valid in Single mode, and confirmation the error surfaces
  through `validateStep(7)` review aggregation with no extra wiring.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build` — exit 0
- [x] `npm run lint` — 0 errors/warnings on touched files
- [x] `node --test lib/__tests__/validate-creatives-book-now-block.test.ts` — 4/4 passing
- [x] `node --test 'lib/**/__tests__/*.test.ts'` — full-suite diff against
      `main` confirms zero regressions: the only failing-test-list delta is
      this PR's own new test file (fails on `main`'s extensionless-import
      version of `validation.ts` with `ERR_UNSUPPORTED_DIR_IMPORT`, passes
      with this fix). Every other failure (asset-queue, dashboard,
      creative-buy-tickets-cta, canonical-tickets-window, etc.) is
      byte-identical between `main` and this branch — pre-existing,
      unrelated, env/timing-dependent in this sandbox.

## Manual smoke test (pre/post)

1. Main wizard → Step 4 (Creatives) → set an ad to Dual or Full asset mode,
   upload both a Feed (4:5) and vertical (9:16) asset, set CTA to
   "Book Now". Pre-fix: the red "Can't launch" banner shows but Continue
   is still clickable and Launch still succeeds. Post-fix: Continue and
   Launch (step 7) are both disabled until the CTA is changed away from
   Book Now (or the creative is switched to Single mode).
2. Confirm switching CTA to "Buy Tickets" (or any non-Book-Now CTA)
   immediately re-enables Continue/Launch with no other changes required.
