# Session log — `/plan/[id]` promoted to the canvas

## PR

- **Number:** 878
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/878
- **Branch:** `cursor/plan-canvas`

PR 3 of 7, campaign creator redesign. Reads `docs/CAMPAIGN_CREATOR_REDESIGN_2026-09-04.md` §2 and §5; builds on the viz kit from #876 and the client presets from #877.

## Summary

`/plan/[id]` is now one screen with seven zones and one button. Every form
control that was not one of the three genuinely per-campaign inputs (window,
budget split, target) has been deleted, and what it used to collect is either
derived or shown as a badge: the plan name comes from the event plus its
derived phase, the objective comes from the target unit, the destination comes
from `events.ticket_url` / `signup_url`, and a platform at 0% of the split is
simply off. The canvas has four states from §2 (READY / BLOCKED / LAUNCHED /
LIVE) plus a fifth, `waiting`, for a plan with no Meta draft — where "blocked"
would overstate what is wrong.

Drawers are PR 4/5, so a row's `open ▸` still navigates to the wizard route.
Every row and every blocker already carries the `{drawer, section}` anchor PR 4
will open at, so that flip is a handler change and not a re-mapping.

## Scope / files

**New pure modules** (all `node --test`-able, no `@/` imports):

- `lib/plan/canvas.ts` — the view model: `planChannelRows`, `planCanvasState`,
  `planLaunchButton`, `planCanvasMenuItemSpecs`, `anchorForIssue`,
  `resumeSupport`, `countDecisionsSince`, and `PLAN_CANVAS_COPY` (every
  sentence the canvas can show, in one place, so the components stay glyphs
  and numbers).
- `lib/plan/canvas-inputs.ts` — zones B/C/D/F: window moments and handles,
  split segments and the `96 · 18 · 6` line, the target chip,
  `planEffectiveTargetUnit`, and `assetStripFromMatrix`.
- `lib/plan/canvas-facts.ts` — the counts each row shows, from the linked drafts.
- `lib/plan/plan-name.ts` — the name rule, moved out of `wizard-shell.tsx` so
  the canvas and the wizard share one.
- `lib/plan/destination.ts` — event `ticket_url` / `signup_url` → destination,
  with a manual override only for an event that has neither.
- `lib/plan/resume.ts` — `▷ resume`, Meta-only, behind `ENABLE_PLAN_FANOUT`.

**New components** (one per zone, `components/plan/canvas-*.tsx`):
`canvas-header`, `canvas-window`, `canvas-budget`, `canvas-target`,
`canvas-channels`, `canvas-assets`, `canvas-launch`.

**Rewritten:** `components/plan/plan-workspace.tsx` — same file, so the existing
grep-guards keep pointing at the plan surface; the interior is now seven zones
plus the handlers they call.

**Server:**

- `app/(dashboard)/plan/[id]/page.tsx` — added `ticket_url`, `signup_url`,
  `event_start_at`, `announcement_at` to the events query, and resolves the
  event thumb, the client preset benchmark, and (only when a platform campaign
  id exists) the funnel view + live spend.
- `app/api/plan/[id]/mirror/route.ts` — now also returns `facts` per adapter,
  because it already loads the three sources those counts come from.
- `app/api/plan/[id]/resume/route.ts` — new. Meta status write to `ACTIVE` via
  the existing `graphPostWithToken` path, gated by `ENABLE_PLAN_FANOUT`.

**Kit:** `lib/viz/status.ts` gained `statusFromLaunchAndBlockers` (a prepared
draft with unresolved blockers is `blocked`, not `ready`; a record that already
reached the platform outranks a stale blocker) and lost `pipelineNodeStatus`,
which existed only to feed the deleted stepper.

## The canvas, rendered

Below is the view model's own output for a real plan — `DOD Plan`
(`299dd4e5-cc76-4419-a5a0-eec5896c95ef`), the `D.O.D` event at NX Newcastle,
read out of prod on 2026-09-04. It is in the LIVE state: the Meta campaign has
delivered £633.09 across 70 rollup days, and TikTok and Google were budgeted
but never prepared.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ▨  DOD Plan  ⓘ                                          ◐ 3 ▸  ⓘ      ⋯   │
│    Electric Brixton   2026-12-04   [NX26-DOD]                              │
│    ⓘ https://dod-newcastle.com/ — pasted by hand                           │
│    [f act_…334 ●] [f page ●] [f pixel …763 ●]                              │
└────────────────────────────────────────────────────────────────────────────┘

  now ▲                gen sale ▲                                    show ▲
  ├──█████████████████████████████──────────────────────────────────────────┤
     2026-08-27                    2026-09-04                     2026-12-04
                                                                          ⓘ

┌──────────────────────────┐  ┌──────────────────────────┐
│ £35 /day        per day  │  │ ◎ £1.60 / reg    target  │  ⌁ modelled  ⓘ ⓘ
└──────────────────────────┘  └──────────────────────────┘
  [daily] lifetime               reg  click  lpv  purchase  view      ⓘ
  ▐▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▐▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▐░░░░░░░░▌      edit ↗
   f 57%                            ♪ 29%              G 14%
   20 · 10 · 5                                              ⌁ man

  ⇄ ⓘ
┌────────────────────────────────────────────────────────────────────────────┐
│ f  ●  £4.21 cpm   £0.09 cpc                                          ▸    │
├────────────────────────────────────────────────────────────────────────────┤
│ ♪  ○  waiting                                                        ▸    │
├────────────────────────────────────────────────────────────────────────────┤
│ G  ○  waiting                                                        ▸    │
└────────────────────────────────────────────────────────────────────────────┘

  ▣ ⓘ   (no asset routes registered for this plan)

  Reach                150,447  ████████████████████████████████  platform
  Clicks                 6,834  ██                                platform
  Landing-page views         —  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  not instrumented
  Signups                1,140  ▌                                 first-party
  Purchases                  0  ┄                                 first-party

                                                     (no button — delivering)
```

The model's raw output for each zone, so nothing above is drawn rather than read:

| Zone | Value |
|---|---|
| A name | `DOD Plan` (stored name wins over the derived one) |
| A destination | `https://dod-newcastle.com/`, source `manual`, `overridable: true` |
| A menu | Duplicate · Save as plan template · Archive plan |
| B moments | `now 2026-09-04` · `gen sale 2026-09-04` · `show 2026-12-04` |
| C split | meta 57% · tiktok 29% · google 14%, amounts `20 · 10 · 5` |
| D chip | `◎ £1.60 / reg`, `provenance: modelled`, `seeded: true`, `inferred: true` |
| E meta | `status: live`, `state: live`, facts `11 audiences · 2 creatives · 12 ad sets` |
| E tiktok/google | `status: idle`, `state: waiting`, no facts, `derived: true` |
| G | `state: live`, `kind: none`, `resumeCount: 0` |

Three things this exposed, all fixed in this PR rather than shipped:

1. **Zone D would have read `— · no unit` for every plan that predates
   migration 165.** The DOD plan has `target_value` and `target_unit` both
   NULL but `objective_intent = registration`. `planEffectiveTargetUnit` now
   reads the unit off the objective and says so in the picker's `ⓘ`; the
   inferred unit is never written back, so the operator's first tap is what
   stores one. `engagement` is the one intent with nothing to price, which is
   exactly the no-unit state §2 keeps the objective picker for.
2. **A delivering plan showed a disabled `▷ Resume 0`.** `planLaunchButton`
   now returns `kind: "none"` when there is nothing paused, and Zone G renders
   no button — the funnel stack under it is the answer.
3. **`anchorForIssue` sent Meta creative blockers to the wrong section.** The
   field map was flat, so TikTok's `creatives: "tt-video"` shadowed Meta's, and
   a Meta creative blocker fell through to `f-audiences`. It is keyed by
   adapter now. Related: the anchor was paired to its issue by array index,
   which breaks the first time `collectBadgeRows` dedupes two issues into one
   row — it looks up by message text now.

## Deleted controls

| Control | Was at (`HEAD` before this branch) |
|---|---|
| `PipelineStepper` (whole component) | `components/viz/pipeline-stepper.tsx:22`, rendered at `plan-workspace.tsx:589` |
| `pipelineNodeStatus` (its only model) | `lib/viz/status.ts:30` |
| `PlanDateTimeField` (whole component) | `components/plan/plan-datetime-field.tsx:13` |
| Start / End datetime fields | `plan-workspace.tsx:677`, `:695` |
| Plan name input | `plan-workspace.tsx:619` |
| Objective `<select>` | `plan-workspace.tsx:630` |
| Destination URL field | `plan-workspace.tsx:647` (and its required-check at `:406`) |
| `Show past events` checkbox | `plan-workspace.tsx:615` |
| `New from plan` button | `plan-workspace.tsx:734` |
| `From existing campaign…` button | `plan-workspace.tsx:735` |
| `Prepare TikTok draft` / `Prepare Google plan` buttons | `plan-workspace.tsx:782` |
| `Re-derive from Meta` button | `plan-workspace.tsx:188` |
| `PlanBudgetControls` (whole component) | `components/plan/plan-budget-controls.tsx` |
| `All` platform toggle | `plan-budget-controls.tsx:117` |
| Three `PlatformToggle`s | `plan-budget-controls.tsx:120` |
| Three per-platform number inputs | `plan-budget-controls.tsx:155`, `:172`, `:229` |
| Four preset text chips | `plan-budget-controls.tsx:188` |

Where each one went:

- Prepare / New from plan / Re-derive collapse into the row: clicking a row
  prepares its draft on first open, and re-derive is the stale chip's own click.
- `From existing campaign…` and `Register N existing assets` moved into Zone A's
  `⋯`, and only ever seed the Meta draft.
- The two schedule notes moved into tips rather than being deleted:
  `GOOGLE_DATE_ONLY_NOTE` onto the `WindowBar`, `WIZARD_ACTIVE_VS_PLAN_PAUSED`
  onto the launch button.
- `PlatformToggle` survives only as `SplitBar`'s legend glyphs. There is no
  separate selection state any more — 0% of the split is the off switch, which
  is what preflight already meant by "skipped".
- The past-events checkbox is gone because `Combobox` is a typeahead and
  `sortPlanEvents` already ranks past events last.
- `PlanIdentityChips` survives, in Zone A's header.

`components/plan/asset-routing-matrix.tsx` is off the canvas but still on disk,
per the brief, in case PR 5's drawer wants it. The grep-guard names it
explicitly and asserts it still exists, so deleting it in PR 5 fails loudly
rather than silently widening the guard.

## What §2 could not be built

1. **`▷ resume` for TikTok and Google — UNVERIFIED, as briefed.** Only Meta has
   a status-write path in this app. Those two rows render `▷` disabled with an
   `ⓘ` reading "Resume in Ads Manager — this app writes status on Meta only."
   plus an `↗` to the platform's own campaign, from the existing
   `planAdsManagerLinks`.
2. **Meta resume itself is untested against live Meta.** `POST /api/plan/[id]/resume`
   posts `status: "ACTIVE"` through `graphPostWithToken`, the same transport the
   optimisation tick uses for budget writes, and is gated by
   `ENABLE_PLAN_FANOUT` — which is off. It has never run against a real paused
   campaign. Treat as UNVERIFIED until a smoke test.
3. **The tickets stage is dashed, not dark.** `FunnelStageBar` renders
   `not instrumented` as a dashed outline, which is what the DOD plan shows for
   landing-page views. No manual-entry affordance was added — §2 says "dashed
   until manual entry", and manual entry is not in this PR.
4. **The decisions handle is a link, not a sheet.** PR 6 owns the sheet. `n` is
   the count of `campaign_automation_decisions` for the linked Meta draft since
   the operator last opened this plan, with `last_opened_at` in `localStorage`
   keyed by plan id — no migration.
5. **`LIVE` is inferred from `event_daily_rollups`, not from Meta.** Fan-out
   creates everything PAUSED, so a launch record saying `live` only means
   "created". Spend in the rollups is the only honest evidence of delivery
   available without a per-render Meta read, so `LAUNCHED` becomes `LIVE` when
   the event has spend. A campaign resumed and spending less than a day ago
   will read `LAUNCHED` until the next rollup.
6. **Zone E's `state` reads `waiting` for an unprepared derived row even when
   Meta exists.** That is `channelRowState`'s own `idle → waiting` fall-through
   from #876. The rendered copy is driven by the separate `waiting` flag, so
   nothing wrong is shown; the field name is just looser than the copy. Left
   alone rather than changing shared kit semantics mid-arc.

## ChannelRow props PR 4's Drawer must receive

`planChannelRows` returns one `PlanChannelRowModel` per platform. The five
fields PR 4 needs, and nothing else changes shape:

```ts
interface PlanChannelRowModel {
  adapter: PlanAdapterName;             // "meta" | "tiktok" | "google"
  status: VizStatus;                    // dot colour, blockers already folded in
  state: ChannelRowState;               // waiting | ready | blocked | paused | live
  facts: ChannelFact[];                 // [{ n, noun }] — the drawer keeps showing these
  derived: boolean;                     // true for TikTok + Google
  waiting: boolean;                     // no Meta draft yet
  waitingFor: VizPlatform;              // always "meta" today
  blockers: BlockerRowModel[];          // each carries its own `anchor`
  anchor: BlockerAnchor;                // where a bare row click lands
  href: string | null;                  // DELETE in PR 4 — the wizard route
  adsManagerHref: string | null;        // keep — the two rows that cannot resume
  draftId: string | null;               // the drawer's subject
  skipped: boolean;                     // 0% of the split
  staleChip: string | null;             // click = re-derive
}
```

Concretely, PR 4 should:

1. Replace `href` with a drawer open. `CanvasChannels` already calls
   `onOpen(row)`, and `plan-workspace.tsx`'s `openChannel` already prepares the
   draft on first open — so PR 4 changes only what happens after
   `prepareDraft` resolves, from `goWizard(...)` to opening the drawer at
   `row.anchor`.
2. Pass `row.anchor` as the drawer's initial section and `blocker.anchor` for a
   blocker click, via `ChannelRow`'s existing `onOpenAnchor`. Every section id
   is one of `PLAN_DRAWER_SECTIONS` — `f-audiences`, `f-creatives`, `f-adsets`,
   `tt-video`, `tt-refine`, `g-keywords`, `g-copy` — and a test asserts no row
   can point at a section outside that table.
3. Per #876, `Drawer` needs `open` and `triggerRef`. `CanvasChannels` has no
   ref today; PR 4 will need one per row to return focus to the row that opened
   it.
4. `row.draftId` is the drawer's subject, and is non-null for any row whose
   drawer can open — `openChannel` prepares before opening, so PR 4 does not
   need to handle a null-draft drawer.
5. `facts` are the same `{n, noun}` counts the row shows, refreshed by the
   mirror endpoint on focus and visibility change. The drawer should read them
   from the row rather than refetching.

## Validation

- [x] `npx tsc --noEmit` — no errors in any source file. The remaining output
      is all pre-existing on `main`: nine errors in `lib/tiktok/__tests__/*`
      and one duplicate-key in `lib/plan/__tests__/schedule-and-continuation.test.ts:148`,
      plus a stale `.next/dev/types/validator.ts` artifact pointing at a route
      that no longer exists.
- [x] `npm run build` — green, `/plan/[id]` still dynamic.
- [x] `npm test` — 4958 pass, 3 skipped, 1 fail. The failure,
      `parseBrief returns event + 6 sends with derived schedule`, is a
      date-rollover in a fixture that hard-codes `2026-09-01`: today is past
      it, so the parser rolls the year to 2027 and the assertion misses by 12
      months. Pre-existing on `main` and unrelated to this PR.
- [x] `npx eslint components/plan lib/plan lib/viz components/viz app/api/plan "app/(dashboard)/plan"`
      — 0 errors. One pre-existing warning in `components/viz/split-bar.tsx`
      (`aria-valuenow` on a `button` role, from #876); left for that thread.

New tests in `lib/plan/__tests__/canvas.test.ts`, with the five state fixtures
in `lib/plan/__tests__/canvas-fixtures.ts`: one describe per zone covering
ready / blocked / launched / live / waiting, the 0%-is-skipped invariant, the
unit → objective re-resolve, the null-target industry seed, the inferred unit
for pre-165 plans, and the `components/plan/**` grep-guard (no `<p>`, no
`CardDescription`, no string literal over 60 characters outside an `InfoTip`-shaped
prop, and no import of a retired control).

## Notes

- **Migration 165 is #877's file and is unchanged here.** This PR reads
  `campaign_plans.target_value` / `target_unit` through the existing
  persist-on-edit path. `CLAUDE.md`'s "Latest migration" is bumped to 165 and
  the routes table gains the canvas line.
- Nine grep-guards across seven existing test files pointed at controls this PR
  deletes. Each was rewritten to assert the same intent against where the
  behaviour moved, not relaxed — e.g. the derived-lifetime guard is now
  stronger, because there is no effect left to flip `hasUserEdit`.
- **Data-integrity finding, out of scope but worth a ticket:** the DOD plan's
  linked Meta draft (`8cec8da7-…`) carries `settings` cloned from an unrelated
  Folamour / Jamie Jones draft — `campaignName: "FOLMAOUR - Signup"` and a
  `settings.eventId` pointing at the Ironworks event. The launched ad sets are
  genuinely NX Newcastle, so only the metadata is stale. The canvas is immune
  because every zone reads the plan row, never `draft_json.settings` — but
  anything that does read those settings will show the wrong event, name and
  budget.
