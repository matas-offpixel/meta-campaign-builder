# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/creator/bulk-attach-relaunch-flow`

## Summary

Adds a "Launch another variation to these ad sets" relaunch flow to both bulk-attach
wizards (event-scoped and client-scoped). After a successful launch, the operator can
now ship additional creative variations into the SAME already-selected ad sets without
redoing campaign/ad-set selection — previously the only options were "Start another
batch" (full reset) or "Back to campaigns/event" (abandon targeting). Guards against
Meta's "one ad per Dynamic Creative ad set" constraint (PR #666) both client-side
(fast pre-check before re-entering Configure creatives) and server-side (hard
enforcement in the launch route, applies to every bulk-attach launch, not just
relaunches).

## Scope / files

- `lib/meta/client.ts` — new `fetchAdSetGuardInfo(adSetIds, token)`: batch-fetches
  live `is_dynamic_creative` + ad count for a set of ad set IDs via the Graph API
  `/?ids=...` multi-object endpoint (one request regardless of count). Best-effort —
  swallows fetch errors and returns an empty map (Meta itself still rejects an invalid
  attach at ad-creation time).
- `lib/bulk-attach/launch-validation.ts` — new `summariseRelaunchGuard(adSets,
  additionalAdsCount)` + `RELAUNCH_AD_COUNT_WARNING_THRESHOLD` (6). Hard block when an
  ad set is Dynamic Creative AND already has ≥1 ad (Meta constraint, mirrors the
  create-time equivalent in `launch-campaign/route.ts`); soft warning (not a block)
  when adding more ads would push an ad set's count past the threshold. Shared by the
  client-side pre-check and the server-side enforcement so the message is identical in
  both places.
- `app/api/meta/bulk-attach-ads/adset-guard/route.ts` — NEW `GET` endpoint. Given
  `adSetIds` (comma-separated), returns live `AdSetGuardInfo[]` for each. Used by the
  wizard's relaunch panel to check ad set state BEFORE the user re-configures
  creatives, rather than only failing after a full relaunch attempt. Returns
  `degraded: true` when the Meta fetch failed entirely so the client can show a
  "could not verify" warning instead of silently reporting all-clear.
- `app/api/meta/bulk-attach-ads/route.ts` — server-side hard enforcement: before the
  per-campaign launch loop, batch-fetches guard info for every unique targeted ad set
  and 400s with `summariseRelaunchGuard`'s `blockedMessage` if any violate the
  Dynamic-Creative-already-has-an-ad rule. Applies to ALL bulk-attach launches (not
  just relaunches) — it's a real Meta constraint that would fail anyway, so this
  fails fast with an actionable message instead of a raw Graph API error mid-run.
- `lib/bulk-attach/draft-state.ts` — `BulkAttachDraftState` / `LiveBulkAttachState`
  gain `shippedVariationsCount` (optional on the persisted shape, defaults to 0 for
  drafts saved before this PR). Threaded through `serialiseDraftState` /
  `deserialiseDraftState` so a resumed draft or localStorage session picks up the
  relaunch indicator at variation N+1 instead of restarting the count.
- `app/(dashboard)/events/[id]/bulk-attach/page.tsx` and
  `app/(dashboard)/clients/[id]/bulk-attach/wizard.tsx` (near-duplicate wizards, kept
  in sync per their existing doc-comment convention):
  - New state: `shippedVariationsCount`, `showRelaunchPanel`, `relaunchKeepCreatives`,
    `relaunchGuardChecking`, `relaunchAdSetGuardInfo`, `relaunchGuardFetchError`.
  - `handleLaunch` bumps `shippedVariationsCount` by `creatives.length` on any launch
    with `totalAdsCreated > 0` (best-effort — counts the whole batch once any ad in it
    succeeded).
  - New third button "Launch another variation to these ad sets" next to "Start
    another batch" on the Launch results screen (only shown once ≥1 ad has been
    created). Opens an inline panel that runs the guard check
    (`GET .../adset-guard`), shows the hard-block message if any target ad set is
    already Dynamic-Creative-with-an-ad, otherwise shows the soft over-threshold
    warning (if any) plus a checkbox ("start from the creative config I just
    launched" — default unchecked, i.e. resets to blank) and a Continue button that
    preserves `selectedCampaigns` + `campaignAdSets`, resets or keeps `creatives`, and
    navigates to step 2 (Configure creatives).
  - Step 2 (Configure creatives) header now shows "Launching variation N/M to X ad
    sets — previous: N-1 variations shipped" whenever `shippedVariationsCount > 0`,
    where N = `shippedVariationsCount + 1` and M = `shippedVariationsCount +
    creatives.length` (recomputed live as the operator edits `creatives` in this
    step), plus the same live over-threshold warning if applicable.
  - `handleReset` ("Start another batch") clears all of the above relaunch state.
  - `serialiseDraftState`/`deserialiseDraftState` call sites (autosave effect, save
    draft, restore-from-localStorage, load draft) all thread
    `shippedVariationsCount` through.
- `lib/bulk-attach/__tests__/launch-validation.test.ts` — new `summariseRelaunchGuard`
  test block (6 cases: hard block, no-block-at-zero-ads, no-block-when-not-dynamic,
  warn-over-threshold, no-warn-at-threshold, empty input).

## Validation

- [x] `npm run build` — exit 0
- [x] `npm run lint` — clean on touched files (pre-existing warnings/errors elsewhere
  unrelated to this change, confirmed via `git status --porcelain` diff)
- [x] `node --test lib/bulk-attach/__tests__/*.test.ts` — 38 pass (32 pre-existing + 6
  new `summariseRelaunchGuard` cases)
- [x] `node --test app/api/meta/bulk-attach-ads/__tests__/route.test.ts` — 21 pass, no
  regressions from the new guard check
- [ ] Manual smoke test (PENDING — needs a live Meta ad account):
  1. Run a bulk-attach launch (event-scoped or client-scoped) into 1+ live ad sets.
  2. On the Launch results screen, click "Launch another variation to these ad sets".
  3. Confirm the panel shows a loading state, then either the confirm UI (checkbox +
     Continue) or — if any targeted ad set is already Dynamic Creative with an ad —
     the hard-block message with no Continue button.
  4. Leave "start from current" unchecked, click Continue → lands on Configure
     creatives with a blank creative and the "Launching variation 2/2 to N ad sets —
     previous: 1 variation shipped" header.
  5. Configure + launch again → results screen "ads created" count reflects the new
     batch; ad sets in Meta Ads Manager should now have both the original + new ad
     (attach semantics, not replace).
  6. Refresh mid-wizard (or navigate away and back) after a relaunch to confirm the
     "unsaved changes" resume banner restores `shippedVariationsCount` and the header
     picks up at the correct N.
  7. (If a test ad account has a Dynamic-Creative ad set with 1 ad already) confirm
     both the client-side panel AND a direct `POST /api/meta/bulk-attach-ads` call
     targeting that ad set are blocked with the same message.

## Notes

- The Dynamic-Creative guard reads Meta's ad set state live rather than reusing
  `creativeTriggersVariationRotation` directly — that helper detects whether an
  *incoming, not-yet-created* creative will trigger rotation, but bulk-attach never
  creates ad sets, so the ground truth is whatever `is_dynamic_creative` Meta already
  has set (immutable once created, per PR #666's `lib/meta/creative.ts` comments).
  `creativeTriggersVariationRotation` remains relevant only for the *new* creative
  being built in this same launch, which is unaffected by this change.
- "Launching variation N/M" interpretation: N = `shippedVariationsCount + 1` (first
  variation number in this batch), M = `shippedVariationsCount + creatives.length`
  (projected total once this batch's creatives all ship) — the spec's own template
  ("previous: N-1 variations shipped") pins N unambiguously; M was under-specified so
  this is the most literal reading that stays internally consistent and updates live
  as the operator adds/removes creative variations in Configure creatives.
- Follow-up (out of scope here): the ad-set picker (step 1) does not yet surface
  Dynamic-Creative / ad-count state for NEW target selection — only the relaunch path
  checks it. A first-time bulk attach into an already-dynamic-with-an-ad ad set will
  still be caught (server-side hard block fires for every launch, not just
  relaunches), just without the earlier client-side heads-up.
