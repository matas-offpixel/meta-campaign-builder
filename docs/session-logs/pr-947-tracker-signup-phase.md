# Session log — tracker signup phase

## PR

- **Number:** 947
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/947
- **Branch:** `cursor/tracker-signup-phase`

## Summary

The Daily Tracker's collapsed pre-general-sale row hid the one phase the
D.O.D campaign (`NX26-DOD`, Electric Brixton) was actually about. It
summed four columns, dropped REGS entirely, and dated itself from the
first rollup row — which, thanks to 60 zero-padded sync rows reaching
back to 27 Jun, read "Presale (from Sat 27 Jun)" for a campaign that
started on 26 Aug. This makes the collapsed row roll up every column it
hides, date itself from the first day with a non-zero metric, name
itself after the phase it covers, and mark the announce / presale /
general-sale days on the table. It also unifies the two ticket
resolvers that made one venue report say 557 at the top and 0 a section
below, and documents the `meta_regs` double count rather than changing
it.

## Scope / files

New shared, unit-tested modules under `lib/dashboard/`:

- `presale-bucket.ts` — one aggregation for the collapsed row. Both
  surfaces that build the bucket (single-event timeline, venue report)
  now call it instead of carrying their own partial sum.
- `presale-bucket-cells.ts` — per-cell projection that keeps `null`
  when a column is null on every day in the bucket.
- `tracker-phase.ts` — milestone vocabulary: phase-aware bucket label,
  day → milestone map, short-day formatting.
- `cost-per-result.ts` — the tracker's one safe divide, behind CPT /
  CPL / CPR on every row. Was local to the component; the bucket's
  nullable numerator and denominator are why it is now shared and
  tested.

Changed:

- `components/dashboard/events/daily-tracker.tsx` — bucket row reads
  the shared cells, milestone badges on dated rows, REGS / CPR /
  Tickets header tooltips, phase-aware subtitle.
- `lib/db/event-daily-timeline.ts`, `components/share/venue-daily-report-block.tsx`
  — delegate to `aggregatePresaleBucket`.
- `lib/db/client-portal-server.ts`, `app/share/report/[token]/page.tsx`,
  `components/dashboard/events/event-detail.tsx` — carry
  `announcement_at` / `presale_at` through to the tracker.
- `lib/dashboard/tier-channel-rollups.ts` — new
  `resolvePortalEventTicketCount`, now the single answer for the venue
  Tickets card and the event-breakdown row.
- `lib/mailchimp/tracker-registrations.ts` — net-new tag members over a
  date range, so a tag-scoped REGS column can fill the bucket cell from
  the same source as the days below it.
- `lib/insights/types.ts` — documents the `metaRegs` double count.

## Validation

- [x] `npx tsc --noEmit` — no new errors (the pre-existing test-file
      errors reproduce identically on `main`)
- [x] `npm run build`
- [x] `npm test` — 5,890 tests, 0 failures
- [x] `npx eslint` on every touched path — clean
- [ ] `ENABLE_PLAN_FRAMES=1 node scripts/plan-frames/run.mjs --check` — cannot
      be run meaningfully on a cloud VM. The baselines are Ubuntu CI raster
      truth; here all 40 frames diff by 1–3% (two at 100%, which error under
      the placeholder Supabase credentials the VM has to use). A run on a
      worktree checked out at pristine `main` produced byte-identical output,
      and the plan-frames render path imports none of the files this branch
      touches, so CI is the real check.

Visual before/after captured from a throwaway harness mounting the real
tracker on the D.O.D rollup shape, with the "before" rendered by a
worktree checked out at `main` so the old `computePresaleBucket` did the
work. Harness removed before commit.

## Notes

Two findings answered but deliberately not fixed here:

1. **`meta_regs` is a double count.** `lib/insights/meta.ts` sums
   `complete_registration` + `offsite_conversion.fb_pixel_complete_registration`
   into `meta_regs`, and Meta reports one pixel registration under both.
   `meta_leads` (`lead` + `offsite_conversion.fb_pixel_lead` +
   `complete_registration`) is the honest count on an event whose only
   conversion is the pixel registration. The same file already has the
   correct de-dup approach for the per-creative path
   (`REGISTRATION_ACTION_PRIORITY`, stop at first match). Fixing the
   rollup writer means rewriting `event_daily_rollups` history, so it is
   a separate PR.
2. **The milestone dates were already editable.** `/events/[id]/edit`
   renders all three as `datetime-local` inputs and `updateEventRow`
   writes them through with no allowlist. Nothing needed to change; the
   `PATCH /api/events/[id]` allowlist stays as it is.
