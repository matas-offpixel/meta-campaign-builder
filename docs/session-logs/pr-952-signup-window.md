# Session log — signup window

## PR

- **Number:** 952
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/952
- **Branch:** `cursor/signup-window`

## Summary

The card, the tracker, and the Daily Trend chart were three
registration surfaces on one page and they did not tell one story.
Cirqlin's all-time 1,843 includes 4 test signups (18–19 Aug) and 250
that happened before any spend (24–25 Aug). The tracker only had
rollup days from 26 Aug, so 254 signups had nowhere to sit. CPR
divided all-time spend by all-time signups. The chart plotted
Mailchimp's reconstructed ramp and sat flat at 1,265.

The campaign now starts on the first day whose `signups_day` is more
than 5 (`SIGNUP_WINDOW_MIN_DAY`). That threshold is derived at read
time — no migration, no backfill. D.O.D starts 24 Aug: the collapsed
bucket is "Signup phase (24 Aug – 8 Sept)" with 1,806 REGS; the card
primary is 1,839 with "4 signups before the campaign window —
excluded."; tracker REGS sums to the card (1,806 + 33). CPR's
denominator is the spend window (26 Aug – 9 Sept): £1,439.37 ÷ 1,589
= £0.91, and the label names both numbers.

The chart takes the same source precedence as the tracker. On D.O.D
that is Cirqlin, a running sum from the window start. Reconstructed
Mailchimp ramp rows are excluded from the series and captioned when
the fallback path would otherwise draw them. Announce / presale /
general-sale markers land on the same days the tracker already marks.
Cirqlin's GROWTH chart reads ~1,845 later the same day; ours is
`totals.counted` captured 15 Sept 12:00 (1,844 − 1 spam = 1,843,
windowed to 1,839). Capture time, not a discrepancy.

## Scope / files

- `lib/dashboard/signup-window.ts` — threshold, window, bucket apply
- `lib/dashboard/signup-phase-cpr.ts` — label names the signup count
- `lib/dashboard/registrations-card-model.ts` — window primary + CPR
- `lib/dashboard/trend-registrations.ts` — chart series
- `components/dashboard/events/daily-tracker.tsx` — bucket start
- `components/dashboard/events/event-trend-chart.tsx` — Cirqlin curve
- Venue / share chart wrappers pass Cirqlin + milestones through

## Round 2

All-time CPR no longer collapses `toDay: null` onto one day — the
helper's own open end is used, and the range starts at the window
when the spend window is all-time, so the denominator is every
signup from that start (1,839 on D.O.D), not 130. A ramp-only
Mailchimp event captions the reconstruction, does not name Meta on
the pill, and does not draw a blank series. Incomplete Cirqlin
per-day history names the gap against `signups_total`. The bucket
keeps its own `earliestDate` when spend starts before the window.
Exactly 5 does not start the window; 6 does.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build` TypeScript step)
- [x] `npm test` — 5963 pass / 0 fail / 4 skipped
- [x] `npm run build` — compiled, typecheck finished, 193 static pages
- [ ] Check-run conclusions on the final head — PR thread, not a commit

## Notes

`computeRegistrationsData` untouched. `evaluate.ts` / `apply.ts` /
`gates.ts` / `components/plan/**` off the file list. No migration.
Sentinel rows are excluded from the window search.

The shared card fixture `signups_day` moved 64 → 1,843 in round 1
so a single-row snapshot's window sum equals the old all-time
primary. Honest for that shape; named here because editing an
input to keep an output is the shape of test-fitting.

Known, not this PR: Mailchimp net-new on the tracker fallback still
differences reconstructed ramp rows. Any event without a Cirqlin page
has per-day registrations that are ramp artefacts. The chart no
longer draws them; the table still can. A ramp-only chart now
states that instead of drawing an unlabelled gap.
