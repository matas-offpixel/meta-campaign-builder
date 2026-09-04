# Session log — the Meta drawer

## PR

- **Number:** 879
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/879
- **Branch:** `cursor/meta-drawer`

## Summary

PR 4 of 7 of the campaign creator redesign. The eight-step Meta wizard is
replaced by one drawer with three tabs and a `details` disclosure. The
drawer is the Meta wizard now, for every campaign: `/plan/[id]` mounts it
as a sheet over the canvas and `/campaign/[id]` mounts the same component
`variant="page"`, so nothing forks. No step internals were rewritten —
every step is mounted behind a `surface="drawer"` prop that strips its
header, its card descriptions and its explanatory sentences and leaves
every control it had.

## Scope / files

**New**

- `lib/plan/drawer.ts` — pure model: the three tabs, the section a row or a
  blocker opens, the `?drawer=f&tab=…` URL, the `⊞` tab's one dependency,
  `validateStep` → badge rows, the `details` rows, and every sentence the
  drawer can show.
- `components/steps/step-surface.tsx` — `StepSurfaceProvider` plus the five
  primitives that decide the chrome rule in one place: `Prose` and `Chrome`
  and `CardDescription` return null in a drawer; `Datum` and `StatusLine`
  keep rendering, as spans.
- `components/plan/meta-drawer.tsx` — the drawer: mode chip, template
  loader, three tabs, blocker badges, launch issues.
- `components/plan/meta-drawer-details.tsx` — the `details` disclosure:
  fifteen resolved data with provenance badges, plus the four demoted
  steps behind sub-disclosures.
- `lib/wizard/use-campaign-draft.ts` — the draft loader and autosave,
  lifted out of `wizard-shell.tsx` so both surfaces share one.
- `lib/plan/__tests__/drawer.test.ts` — 60 tests.
- `scripts/codemod-step-chrome.mjs` — one-shot; delete after PR 7.

**Changed**

- `components/wizard/wizard-shell.tsx` — the stepper, the eight step
  mounts and the wizard's own template loader are gone; it renders the
  drawer and, for a standalone draft only, review.
- `components/wizard/wizard-footer.tsx` — no Back / Continue / Load
  Template; Launch is conditional on the draft having no plan.
- `components/plan/plan-workspace.tsx` — Meta rows and Meta blockers open
  the drawer in state, with a shallow URL replace; TikTok and Google still
  navigate until PR 5.
- `components/plan/canvas-channels.tsx`, `components/viz/channel-row.tsx`
  — `openRef` per row and `onOpenAnchor` up from the blocker badge.
- `components/viz/drawer.tsx` — `variant="sheet" | "page"`, header and
  footer slots, `doneLabel`.
- `lib/plan/canvas.ts` — `drawerBlockers` input, deduped onto the row.
- `app/api/plan/[id]/mirror/route.ts` — returns those blockers.
- `lib/viz/tokens.ts`, `lib/plan/canvas-inputs.ts` — `industry seed`.
- Nine step files and one picker — `surface` prop and chrome routed.

## Validation

- [x] `npx tsc --noEmit` — clean for every touched source file. Pre-existing
      errors remain in unrelated test files (`jest` globals, `ProcessEnv`
      casts, `lib/landing-pages/__tests__/wizard-renderability.test.ts`).
- [x] `npm run build` — passes; `/plan/[id]` and `/campaign/[id]` stay dynamic.
- [x] `npm test` — 5018 pass, 1 fail. The failure is
      `parseBrief returns event + 6 sends with derived schedule`, which
      fails identically on `main`: the D2C brief fixture's "Sept 1" has
      passed, so the parser rolls it to 2027.
- [x] `npx eslint` — no new errors. The two that remain
      (`campaign-multi-picker.tsx`, `interest-groups-panel.tsx`, both
      "setState synchronously within an effect") are on `main` too, at the
      same statements.

## Notes

Two guard tests were updated rather than left untouched, both because PR 4
is the thing they were waiting for:

- `lib/plan/__tests__/persist-handoff.test.ts` asserted `goWizard` with the
  comment "until PR 4 lands the drawers". It now asserts
  `openDrawerOrWizard`.
- `lib/viz/__tests__/viz-kit-redesign.test.ts` matched the literal `>Done<`
  in the drawer source. `Done` is a prop default now, so it asserts
  `doneLabel = "Done"` and `>{doneLabel}<`.

Follow-ups:

- Save-as-Template has no drawer equivalent, so it stays in the page
  variant's footer. A plan-linked draft saves a template by opening the
  draft standalone. Build D specced a loader only.
- `components/steps/campaign-picker.tsx` has no importers and is dead —
  a PR 7 deletion.
