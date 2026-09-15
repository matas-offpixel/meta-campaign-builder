# Session log — Cirqlin sends pages[], not page

## PR

- **Number:** 951
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/951
- **Branch:** `cursor/cirqlin-payload-pages`

## Summary

The live partner route returns `pages[]`; `isCirqlinSignupsPayload`
required `page`. `ok` and `tag` passed, `page` was `undefined`, the
guard returned false, and every live read fell through to the generic
tail as `unexpected status 200` — so the REGISTRATIONS card stayed on
the Mailchimp segment count of 1,686. Two prompts were written with
different contracts and each side built what it was told; Cirqlin is
live and correct, so the dashboard is the side that changes. Widening a
runtime validator cannot reject anything it accepts today, and
Cirqlin's key allowlist throws at request time on any key outside its
Set, so `page` can never appear there.

The guard now requires `Array.isArray(v.pages)` — the name changes, the
structural check does not. A 2xx that fails the guard now says
`response did not match the partner payload shape`, because
`unexpected status 200` sends the reader to HTTP for a schema problem.

`multiple` is the flag that says a tag spans several Cirqlin pages.
Cirqlin already sums `totals` across them, so the number is right, but
we map one `mailchimp_tag` to one event — so the card now says
`Counted across 2 Cirqlin pages on this tag.` under the number. Fixing
the join stays a later problem; this stops it being a silent one.

`daily[]` is bucketed by the page's own zone, echoed as
`daily_timezone`, so `lib/cirqlin/london-day.ts`'s claim that Cirqlin
days are Europe/London was no longer true. The module was dead (only
its own test imported it) and is deleted; a test greps `lib/cirqlin/`
to keep the claim gone. `pages`, `multiple` and `daily_timezone` are
persisted into `raw_json`, and the empty-`daily` fallback row uses
`daily_timezone` instead of a UTC slice of `capturedAt`.

`sync.mailchimp.failed` is distinct signups, not attempts:
`public.sync_status` is keyed `(signup_id, target)`, so a retry updates
in place. Verified against the Cirqlin database — 19,133 rows, 19,133
distinct pairs, 0 duplicates. The card copy stays
`4 signups did not reach Mailchimp (invalid email)`.

## Scope / files

- `lib/cirqlin/types.ts` — `pages: CirqlinPage[]`, `multiple`,
  `daily_timezone`; page gains `event_date` / `timezone`
- `lib/cirqlin/client.ts` — `pages` guard, shape message on a 2xx
- `lib/cirqlin/snapshot-rows.ts` — `raw_json` carries `pages`,
  `multiple`, `daily_timezone`; `calendarDayIn` for the zero-day row
- `lib/cirqlin/london-day.ts` + its test — deleted
- `lib/dashboard/registrations-card-model.ts` — `scopeLine`
- `components/report/signup-registrations-card.tsx` — renders it
- `lib/cirqlin/__tests__/live-partner-body.ts` — the live body as a
  fixture, shared by the client and snapshot-row tests

## Validation

- [x] `npx tsc --noEmit` (via `npm run build` TypeScript step)
- [x] `npm test` — 5947 pass / 0 fail / 4 skipped
- [x] `npm run build` — compiled, typecheck finished, 193 static pages
- [ ] Check-run conclusions on the final head — PR thread, not a commit

## Notes

No migration — `signup_source_snapshots` is applied and its shape is
unchanged. `computeRegistrationsData` untouched. `evaluate.ts` /
`apply.ts` / `gates.ts` / `components/plan/**` off the file list.
Nothing in `matas-offpixel/cirqlin` is touched.

Known live exposure, not fixed here: `cirqlinSignupsForWeek` builds its
window in UTC (`new Date(\`${weekStartMonday}T00:00:00Z\`)`) and the
day/range readers compare `row.day` as a bare string against keys
generated elsewhere. For a non-London event those buckets drift a day
against the spend column beside them. Every event today is UK, so
nothing is wrong now — and because `daily_timezone` is persisted, the
day it matters the evidence is already in the row.
