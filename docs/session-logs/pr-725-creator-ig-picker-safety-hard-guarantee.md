# Session log — IG picker safety hard guarantee

## PR

- **Number:** 725
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/725
- **Branch:** `cursor/creator/ig-picker-safety-hard-guarantee`

## Summary

Closes task #96. The wizard could publish an ad under a different Instagram
handle than the operator picked. `resolveIgActorForAdAccount` substituted the
**first** actor from `GET /act_{id}/instagram_accounts` whenever the picked IG
wasn't in that list; the swap was a `console.warn` and otherwise invisible, so a
creative built for `@electricstudiossheff` shipped as `@shuffa_uk`. The swapped
id was also written back into the wizard through `/api/meta/page-identity`, so
`identity.instagramActorId` — the id Phase 3 sends as
`object_story_spec.instagram_user_id` — was already wrong before launch.

The resolver now holds one invariant: **when a picked IG id is supplied it
returns that exact id or no id at all — never a different account.** Unauthorised
picks surface as `unauthorised_mismatch` and the launch is hard-blocked in
Phase 1.5 with the authorised handles and a `/business-managers` remediation
link, before any creative is created.

## Scope / files

**New**

- `lib/meta/ig-identity-guard.ts` — pure verdict logic (`evaluateIgIdentity`),
  aggregated operator-facing messages (`describeIgMismatch(es)`,
  `buildIgGrantUrl`), and the audit-line formatter.
- `lib/meta/ig-picker-options.ts` — picker option building extracted from the
  panel component so the no-default rule is unit-testable.
- `lib/meta/__tests__/ig-picker-safety.test.ts` — 18 tests.

**Changed**

- `lib/meta/page-token.ts` — removed the `ad_account_first` silent substitution;
  added `unauthorised_mismatch` + `adAccountActors` to `ResolvedIgActor`; page
  level linkage now vouches for the *same* id instead of returning the page's
  first IG.
- `app/api/meta/launch-campaign/route.ts` — new Phase 1.5 IG authorisation
  preflight (400 + aggregated `details`); Phase 0e logs the mismatch case
  instead of claiming "all resolution paths failed".
- `app/api/meta/page-identity/route.ts` — surfaces `authorisedActors`; no longer
  reports a substituted actor as the resolved one.
- `lib/meta/client.ts`, `lib/types.ts`, `app/api/meta/instagram-accounts/route.ts`,
  `lib/hooks/useMeta.ts` — carry `isPagePrimary` (the Page's
  `instagram_business_account`) through to the UI.
- `components/wizard/page-instagram-overrides-panel.tsx`,
  `components/steps/creatives.tsx` — "Recommended" hint on the Page's own IG,
  red required-field marker while unset, no pre-selection.

## Design decision: block only on positive evidence

The preflight blocks **only** when the ad account returned a *non-empty* actor
list and the pick is absent from both it and the page's linked-IG list.

An empty or unfetchable list is treated as unverified and never blocks. That
asymmetry is load-bearing:

- The app OAuth token has narrower asset visibility than Matas's Ads Manager
  session — an empty list usually means "can't see it", not "not authorised".
- PR #567 (4thefans WC26): agency setups link the IG to the Page but not to the
  ad account as a BM asset; the ad-account list legitimately omits it.
- PR #602: a transient empty list previously caused the operator's pick to be
  dropped entirely, which is how `@ionfestival` hit an EU DMA rejection.

Blocking on absence of evidence would reintroduce both failures. Tests pin this
explicitly (`Absence of evidence never blocks`).

## What was already in place (not re-implemented)

Most of "Failure 1 — silent wrong default" had already shipped and was verified
rather than rebuilt:

- `PageInstagramOverridesPanel` never pre-selects for multi-IG pages.
- `creatives.tsx` auto-fills only when the page has exactly one linked IG.
- `findMultiIgPagesMissingOverride` blocks Continue at steps 3 and 4 and Launch
  at step 7; `launch-campaign` blocks server-side too.

The genuinely missing piece was the **"Recommended" hint**. BM ownership data
doesn't exist yet (it arrives with BM Asset Sync v2 / `bm_ig_accounts`), so the
recommendation uses the Page's `instagram_business_account` instead. That is the
correct discriminator for the reported case: Junction 2's Page lists both
`@junction_2` (its business account) and `@__mastery` (a creator account sharing
an admin), and only the former is ever the right ad identity.

## Validation

- [x] `npm run build` — exit 0
- [x] `npm run lint` — 8 errors on touched files, byte-identical to `main`
      (all pre-existing `react-hooks/set-state-in-effect` in untouched regions
      of `lib/hooks/useMeta.ts`); 0 introduced
- [x] `npm test` — no delta vs the pre-change baseline (18 pre-existing failures,
      all `@/lib` alias resolution or unrelated assertions); 18 new tests pass

## Manual smoke test

1. Open a campaign whose Facebook Page has 2+ linked IGs (Junction 2).
2. Step 4 → Creatives → Instagram Account: dropdown shows **no selection**, a red
   "Required" message, and the Page's own handle labelled `— Recommended`.
   Continue is blocked.
3. Pick the correct handle → Continue unblocks.
4. Launch. Check the Vercel log for
   `[ig-identity-audit] stage=launch-preflight … pickedIgId=… resolvedIgId=… source=authorised:*`
   and confirm the Phase 3 pre-post summary shows
   `instagram_user_id SET ✓ (<picked id>)`.
5. Negative case: pick an IG that isn't on the ad account's actor list. The
   launch must return
   `Launch preflight failed — Instagram account not authorised on this ad account`
   with the authorised handles listed — no ad created, no silent substitution.

## Notes / follow-ups

- **Not in scope:** `bulk-attach-ads` still resolves IG identity through
  `createIgActorValidator`, whose failure mode is *omitting*
  `instagram_user_id` (page-only identity), not substituting another account —
  so it carries no wrong-handle risk and was left alone to keep this PR small.
- `resolveIgActorForAdAccount` still falls back to `META_ACCESS_TOKEN` when no
  user token is passed (pre-existing, untouched here). Worth removing alongside
  the BM Asset Sync v2 token work.
- The mismatch message deep-links to `/business-managers?tab=ig-accounts`. That
  tab lands with BM Asset Sync v2 (PR A); until then the link opens the existing
  Pages view, which is still the right page to be on.
- The `bm=` query param is only emitted when a business id is known. The launch
  route doesn't resolve one today, so the link currently omits it — wiring
  `client_business_managers` through is a natural follow-up with PR A.
