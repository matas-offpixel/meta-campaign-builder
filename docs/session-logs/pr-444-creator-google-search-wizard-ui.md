# Session log — Phase 2: Google Search wizard UI

## PR

- **Number:** 444
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/444
- **Branch:** `creator/google-search-wizard-ui`

## Summary

Ships the Google Search Campaign Creator wizard UI on top of Phase 1's
(PR #443) data model + xlsx importer. New route `/google-search/[id]`
loads the full `GoogleSearchPlanTree` server-side and renders an
8-step wizard for reviewing imported plans, editing them inline, and
pushing to Google Ads. The push step calls a route stub that will be
wired to the real Google Ads write adapter in Phase 3 — the stub
already runs the same hard validation the Review step does so an
invalid plan can never reach the push adapter. A new
`(dashboard)/google-search` index lists every plan with status pills,
a "New plan" button (POST → blank plan → wizard), and an "Import xlsx"
button (POST to the Phase 1 importer → wizard).

## Scope / files

New (non-shared):

- `app/google-search/[id]/page.tsx` — server component, loads tree +
  events + Google Ads accounts.
- `app/(dashboard)/google-search/page.tsx` — plan index.
- `app/api/google-search/route.ts` — `POST` creates a blank plan.
- `app/api/google-search/[id]/route.ts` — `PUT` autosave (replaces the
  tree via `saveGoogleSearchPlanTree`).
- `app/api/google-search/[id]/push/route.ts` — Phase 2 stub. Refuses
  hard-error plans with 422, otherwise returns
  `{ ok: false, reason: "not_implemented" }` with HTTP 501 so the UI
  can render a friendly "Phase 3 stub" notice.
- `components/google-search-wizard/wizard-shell.tsx` — orchestrator
  (8-step nav, debounced autosave, validation strip, footer).
- `components/google-search-wizard/steps/plan-setup.tsx`
- `components/google-search-wizard/steps/campaigns.tsx`
- `components/google-search-wizard/steps/ad-groups-keywords.tsx`
- `components/google-search-wizard/steps/negatives.tsx`
- `components/google-search-wizard/steps/ad-copy.tsx`
- `components/google-search-wizard/steps/targeting-budget.tsx`
- `components/google-search-wizard/steps/review.tsx`
- `components/google-search-wizard/steps/push.tsx`
- `components/google-search/plan-actions.tsx` — landing-page client
  component for the "New plan" / "Import xlsx" buttons.
- `lib/google-search/validation.ts` — pure per-step and plan-wide
  validators. Hard errors block push; warnings flag concerns.
- `lib/google-search/tree-mutations.ts` — immutable helpers
  (`addCampaign`, `addKeyword`, `addRsa`, etc.) so step components
  don't redo nested-tree updates by hand.
- `lib/google-search/__tests__/validation.test.ts` (30 assertions).
- `lib/google-search/__tests__/tree-mutations.test.ts` (11 assertions).

Files NOT touched (per the prompt's non-negotiables):

- `lib/types.ts` (shared root state) — Google Search types live in
  `lib/google-search/types.ts` from Phase 1.
- `components/wizard/**` (Meta wizard) — Google Search has its own
  shell.
- `supabase/migrations/**` — no schema changes in Phase 2.
- No new dependencies.

## State management

Diverges from the Meta wizard's reducer-heavy `WizardShell` in favour
of the simpler `TikTokWizardShell` pattern:

- Server page loads the tree once via `loadGoogleSearchPlanTree` and
  passes it as `initialTree` to the shell.
- Shell holds `useState<GoogleSearchPlanTree>`.
- Every step receives `(tree, onChange)` and updates via the pure
  `tree-mutations` helpers. After each call to `onChange`, the shell
  debounces an autosave (1500ms, matching the Meta wizard's cadence)
  to `PUT /api/google-search/[id]`.
- The save route does the full nuke-and-rewrite via Phase 1's
  `saveGoogleSearchPlanTree`. The wizard then replaces local state
  with the server's canonical tree (real UUIDs replacing the wizard's
  `tmp-` ids) so subsequent edits don't drift.

The plan tree is small (≤ a few hundred rows in realistic use), so we
skipped `localStorage` mirroring — the autosave round-trip is already
fast enough that a network burp during edit recovers cleanly via the
next save attempt.

## Validation

- `npx tsc --noEmit` — no new errors. Pre-existing failures on `main`
  (`lib/audiences/__tests__/bulk-website.test.ts`,
  `lib/audiences/__tests__/campaign-videos-route.test.ts`,
  `lib/dashboard/__tests__/funnel-aggregations.test.ts`,
  `lib/meta/__tests__/audience-idempotency.test.ts`) are unrelated to
  this PR.
- `npx eslint app/google-search/ app/api/google-search/ components/google-search-wizard/ components/google-search/ lib/google-search/ app/(dashboard)/google-search/`
  — clean.
- `npm run build` — passes; `/google-search` and `/google-search/[id]`
  show up in the route list.
- `node --experimental-strip-types --test lib/google-search/__tests__/validation.test.ts lib/google-search/__tests__/tree-mutations.test.ts`
  — 41 / 41 pass.

## Validation rules

Implemented in `lib/google-search/validation.ts`:

Hard errors (block push, gate Review step):

- Plan name missing
- No Google Ads account selected
- 0 campaigns
- Campaign with 0 ad groups or 0 keywords
- Ad group with 0 RSAs
- RSA with <3 headlines or <2 descriptions (Google minimums)
- Headline >30 chars or description >90 chars
- Total campaign budgets exceed the plan total

Soft warnings (allow push, flag in Review panel):

- Keyword matches a negative (cannibalisation; case-insensitive)
- Campaign has no negatives at all
- Campaign budgets sum to less than 50% of plan total

## Test coverage trade-off

The prompt asked for a "DOM-level test for at least the Review step's
validation panel". The repo currently runs `node --test` only — no
React DOM testing library is installed and the dashboard rules forbid
adding dependencies without approval. To stay on-spec:

- The Review panel is a pure function of `validateGoogleSearchPlan` →
  `IssueList`. The validator is exhaustively tested (12 cases covering
  char limits, RSA counts, conflict detection, budget math, account
  gating, step gating). Any future regression in the panel's
  contents will fail at the validator level.
- Both `CharLimitedRow` and the Review panel expose `data-testid` hooks
  (`char-counter`, `gs-validation-panel`, `gs-validation-empty`,
  `gs-review-summary`) so a downstream PR that adds `vitest` +
  `@testing-library/react` can target them without further wiring.

## Phase 3 hand-off

The push route already loads the tree, runs validation, and returns
`{ ok: false, reason: "not_implemented" }` with HTTP 501. Phase 3
needs to:

1. Replace the 501 branch with the real Google Ads write adapter
   (build on `lib/google-ads/client.ts`'s `mutate()` from PR #442).
2. On success, return `{ ok: true, createdCampaigns, createdAdGroups, createdKeywords }`
   — the wizard's `PushStep` already renders that shape.
3. Persist the returned `resource_name`s back onto the plan tree
   (`pushed_resource_name` columns) and switch the plan status to
   `pushed` or `partially_pushed`. The wizard already optimistically
   stamps `status: "pushed"` and `pushed_at` on a successful
   response — Phase 3 should adjust this once `partially_pushed` is a
   real outcome.
4. Replace `saveGoogleSearchPlanTree`'s nuke-and-rewrite with a
   diff-aware writer so push metadata survives further wizard edits.

## Notes

- Bidding strategy: `maximize_clicks` is the default per Phase 0
  guidance — no conversion tracking integration in v1.
- Currency is hard-coded `£` in the UI strings (matches Phase 1's
  importer). Multi-currency support is out of scope for the wizard.
- The Push step has both an inline Push button and a footer Launch
  button. The footer button dispatches a synthetic click on the
  inline button (hidden `<button id="gs-push-trigger">`) so the action
  surface mirrors the Meta wizard's "Launch Campaign" footer slot
  without prop-drilling the handler all the way up the tree.
