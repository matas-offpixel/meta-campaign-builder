# Session log: Step 5 Advantage+ auto-clear for unsupported objectives (task #127)

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/step5-advantage-plus-auto-clear-unsupported`

## Summary

PR #760 disabled the per-row Advantage+ Audience toggle whenever the campaign's
objective doesn't support it (Meta subcode 1870196: `awareness`, or
`registration` under any goal), but never *cleared* an already-set
`advantagePlus: true` on such an ad set. That left two real scenarios
permanently unlaunchable with no fix available in the UI:

1. An ad set duplicated with Advantage+ ON before #760 shipped.
2. A campaign's objective switched (Step 2) from a supported one (e.g.
   Sales) to an unsupported one (e.g. Registration) *after* ad sets were
   already configured in Step 5.

Both hit the launch-time preflight (`advantageAudienceObjectiveMismatchMessage`
in `lib/meta/advantage-plus-compat.ts`) and rejected the launch, telling the
operator to "turn off Advantage+ Audience... in Step 5" — a control that,
for these ad sets, no longer exists (toggle disabled) or never existed at all
(blank ad sets, whose toggle is always locked).

Implemented the user's preferred **option 2 (auto-normalise)**: Step 5 now
force-clears `advantagePlus` to `false` on every affected ad set — including
"blank" ones, which the toggle can never reach manually — as soon as it
detects the objective doesn't support it (on mount and on every subsequent
objective/goal or ad-set-list change), and shows a one-time dismissible
banner: "Cleared Advantage+ Audience from N ad set(s) — Meta doesn't support
it for [objective] campaigns." No operator click required.

The launch-time preflight message was also updated to stop telling operators
to "turn off Advantage+ Audience... manually" and instead point them back to
Step 5, which now self-heals automatically.

## Scope / files

- `lib/wizard/adset-suggestions.ts` — new pure helper
  `clearUnsupportedAdvantagePlus(suggestions)`, returning the cleared array
  plus a `clearedCount`. Deliberately clears blank ad sets too (see doc
  comment: without this, a blank ad set on an incompatible objective would
  be the one row type still permanently stuck, since its toggle is locked
  and can never be turned off from the UI).
- `components/steps/budget-schedule.tsx`:
  - A `useEffect` (deps: `advantagePlusSupported`, `adSetSuggestions`,
    `onSuggestionsChange`) calls `clearUnsupportedAdvantagePlus` and, if
    anything changed, pushes the cleared array up via `onSuggestionsChange`.
    This effect **only** touches the external system (the parent's draft
    state) — no local `setState` inside it, per the
    `react-hooks/set-state-in-effect` lint rule enforced in this repo's
    Next.js-bundled ESLint config.
  - The "cleared N ad sets" notice is derived separately, entirely during
    render (React's "adjust state while rendering" pattern — no refs, since
    this repo's lint also enforces `react-hooks/refs` disallowing ref reads
    during render): a `prevSuggestionsForNotice` state snapshot is diffed
    against the incoming `adSetSuggestions` prop each render, counting rows
    whose `advantagePlus` flag just flipped true → false. That transition
    only ever happens via the effect above, so this reliably fires exactly
    once per auto-clear.
  - Row-level tooltip/disabled logic reordered so the "objective doesn't
    support Advantage+ Audience" message takes priority over the
    blank-ad-set message when both apply, and now says "automatically
    cleared" instead of "Toggle disabled."
  - The blank-ad-set hint banner is now conditional on
    `advantagePlusSupported`; when unsupported it explains the ad set runs
    as plain broad targeting instead of "locked ON" Advantage+ prospecting.
- `lib/meta/advantage-plus-compat.ts` — `advantageAudienceObjectiveMismatchMessage`
  reworded: points the operator back to Step 5 (which now self-heals) instead
  of instructing a manual toggle-off they may not be able to perform.
- Tests:
  - `lib/wizard/__tests__/adset-suggestions.test.ts` — new
    `clearUnsupportedAdvantagePlus` describe block (clears set rows, clears
    blank rows, no-op when nothing to clear, doesn't mutate input).
  - `lib/meta/__tests__/advantage-plus-compat.test.ts` — new assertion that
    the mismatch message points at Step 5's auto-clear and does NOT say
    "turn off" / "disable Advantage+".

## Validation

- [x] `npx tsc --noEmit` — 370 pre-existing errors, identical set before/after (diffed).
- [x] `npm run build` — succeeds.
- [x] `npm test` — 3624 tests, 3608 pass, 13 fail; all 13 failures are
      pre-existing (dashboard/`@/lib` alias resolution issues, asset-queue,
      creative-buy-tickets-cta) and unrelated to this change — none touch
      `budget-schedule.tsx`, `adset-suggestions.ts`, or
      `advantage-plus-compat.ts`.
- [x] `npm run lint` — repo-wide baseline warnings/errors unchanged; zero
      lint problems in any file touched by this PR (confirmed via targeted
      `npx eslint` runs plus grep over the full `npm run lint` output).

## Notes

- Considered the alternative from the task brief (Option 1: keep the toggle
  clickable-off with a warning style + explicit "Clear" button) but the user
  explicitly preferred auto-normalise, and with it in place `advantagePlus`
  can never actually be `true` + unsupported in steady state — so a manual
  "Clear" affordance would be dead code most of the time. Not implemented.
- The blank-ad-set case turned out to be in scope even though the original
  bug report only mentioned the per-row toggle: blank ad sets are *always*
  created with `advantagePlus: true` and their toggle is permanently
  disabled, so without extending the auto-clear to them, PR #760's own
  preflight would have introduced a *new* unfixable-from-the-UI case
  identical in shape to the one this task closes. Flagged here rather than
  silently expanding scope.
