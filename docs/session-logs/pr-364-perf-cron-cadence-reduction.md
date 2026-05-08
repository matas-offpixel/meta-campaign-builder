# Session log — perf/cron-cadence-reduction (PR-E)

## PR

- **Number:** #364
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/364
- **Branch:** `perf/cron-cadence-reduction`

## Summary

Drop the three Meta-touching crons
(`refresh-active-creatives`, `refresh-creative-insights`,
`rollup-sync-events`) from 5×/day to 3×/day for the steady-state
roster, then layer a `show-week-burst` cron at 3× extra/day for
events with `event_date` in the next 7 days. Net effect: ~30–40%
fewer Meta calls/day per ad-account on the cold-week events,
unchanged-or-better freshness on the show-week events that actually
need it.

`sync-ticketing` and the TikTok crons stay at 5×/day — ticket data
is the live signal and TikTok's per-account budget is the cheap
side of the integration. `cadence_tier` field added to every Meta
cron's response payload + log line ("base" vs "burst") so usage
becomes greppable from the Vercel logs.

## Scope / files

- `vercel.json` — drop `refresh-creative-insights`,
  `rollup-sync-events`, `refresh-active-creatives` from 5× to 3×
  (`6,12,18` UTC). Add `show-week-burst` at `20 8,14,20`.
- `app/api/cron/show-week-burst/route.ts` — new route. Bearer auth
  identical to other crons. Eligibility: `event_date BETWEEN now()
  AND now() + 7 days` AND (`event_ticketing_links` row OR
  `meta_campaign_id` populated). For each eligible event runs the
  same `runRollupSyncForEvent` + `refreshActiveCreativesForEvent`
  the base crons run, with the same per-event try/catch isolation
  and the same thumbnail warm callback.
- `app/api/cron/refresh-active-creatives/route.ts` — add
  `cadence_tier: "base"` to `CronResponse` + log lines.
- `app/api/cron/rollup-sync-events/route.ts` — same.
- `app/api/cron/refresh-creative-insights/route.ts` — same.

## Validation

- [x] `npm test` — 853 pass / 0 fail.
- [x] `npm run build` — clean. `/api/cron/show-week-burst` registers.
- [x] No new lint warnings on the changed files.
- [ ] Vercel Cron settings page reflects the new schedule after
      deploy.
- [ ] Manual `curl` of `/api/cron/show-week-burst` on a
      non-show-week test confirms the route iterates only events in
      the 7-day window (eventsConsidered > 0 only when WC26 is
      <7d out, otherwise 0 in the steady state).
- [ ] Total Meta API calls/day per ad-account drops by ~30–40%
      after 2 days running new schedule.

## Notes

- The `show-week-burst` route reuses the **runner functions**
  directly (`runRollupSyncForEvent` /
  `refreshActiveCreativesForEvent`) — no fetch indirection — so the
  per-event isolation, snapshot write contract, and Meta retry
  policies all stay identical to the base crons.
- Snapshot writes refuse on `kind: "skip" | "error"` inside
  `refreshActiveCreativesForEvent` per the existing contract; the
  burst route honours that without explicit re-checking.
- PR-F (cron stagger extension) follows: stretches the 3× base
  Meta cycle from a 30-min window to a 90-min window so any single
  ad-account never has more than one Meta cron firing within a
  30-min slot.
- The legacy 5× cadence is preserved on `sync-ticketing` because
  ticketing data is what users grade dashboard freshness against
  and Eventbrite has its own (separate) rate-limit budget.
