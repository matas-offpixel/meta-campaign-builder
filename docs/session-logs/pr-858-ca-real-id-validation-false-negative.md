# Session log

## PR

- **Number:** 858
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/858
- **Branch:** `cursor/ca-real-id-validation-false-negative`

## Summary

The #757 custom-audience availability rule treated populating / code 441
(and `delivery_status !== 200`) as dead, so DJ EZ — NEWCASTLE — Signup
(Copy) (`cd116701-a94c-4f54-a332-35fbf1368342`) aborted both page_group
ad sets on every launch and every #856 retry with "all IDs failed real-ID
validation" even though Meta returned 32 live engagement ids and 441
("You can start running ads with this audience straight away."). Same-launch
receipts are now trusted without a lookup; reused ids are validated per-id
and 441 is valid; 411/412/missing still drop.

## Mechanism (falsified before the fix)

Two hypotheses. Read `fetchCustomAudienceAvailability` /
`prepareAdSetPayloadForCreate` / `preflightDropUnavailableAudiences` /
the 441 salvage overlay, then the live draft.

- **(a) Listing membership — falsified for this path.** The validator
  never GETs `/act_/customaudiences`. It batch-GETs by id
  (`graphMultiGetByIds`). Newest-falling-off-page-one is a real class
  elsewhere (ads scan-limit / 1000-row traps), not this abort.
- **(b) Delivery/readiness filter — confirmed.**
  1. `fetchCustomAudienceAvailability` used
     `delivery_status !== 200 ? false : op !== 411 && op !== 412`.
     A live 441 row with delivery 300 (typical while populating) was
     `available: false`.
  2. After a 1359207, the readiness overlay forced any
     `waitForAudienceReady` `ready: false` (including timed-out 441)
     to `available: false`.
  3. DJ EZ Garage Audience: 32 statuses created 2026-08-26T17:20Z, all
     `lastReadinessCode=441`, `engagementAudienceIds` empty on disk.
     Phase 1.5 **reuses** them (not added to `freshlyCreated…`). 32 ≥ 20
     → preflight → all marked unavailable → targeting emptied →
     `hasAudienceTargeting` abort with the real-ID fallback string.
     #856 retry is `handleLaunch` → same launch-campaign prepare.

The falsifying test encodes exists + beyond listing page one (32 ids,
page size 25) + populating: the legacy delivery filter returns false;
`classifyCustomAudienceAvailability` keeps every id.

## Before / after — DJ EZ draft

| | Before | After |
|---|---|---|
| Garage Audience / Garage Audience 2 | Abort: "No valid targeting — all IDs failed real-ID validation" | 32 receipt/441 ids stay in `custom_audiences`; create proceeds |
| Same-launch / Phase 1.5 reuse receipts | Treated as reused; preflight lookup | Trusted; no availability GET |
| Reused/older ids | Listing-shaped delivery filter | Per-id GET; 441/400/non-200 delivery = valid |
| 411 / 412 / missing | Dropped with named note | Unchanged (#757) |
| All ids confirmed dead | Abort, nothing to target | Unchanged |
| #856 Retry failed ads | Same broken prepare | Same fixed prepare (no parallel validator) |

## Scope / files

- `lib/audiences/ca-availability-recovery.ts` — `classifyCustomAudienceAvailability`
- `lib/meta/client.ts` — `fetchCustomAudienceAvailability` uses the classifier
- `lib/audiences/adset-create-with-salvage.ts` — receipt trust; 441 overlay removed
- `app/api/meta/launch-campaign/route.ts` — Phase 1.5 receipts on reuse + create; 4 prepare sites + MC clone
- Tests: classifier/DJ EZ repro, same-launch trust, 441 keep, dead-id drop, #856 retry wiring

## Validation

- [x] Targeted: 69 pass (ca-availability, salvage, MC parity, transient-retry)
- [x] `npm test` — 4539 tests, 4536 pass, 0 fail, 3 skipped
- [x] `npm run build` — compiled successfully (Next.js 16.2.1)
- [x] ESLint on touched files — 0 errors (4 pre-existing unused-var warnings in launch-campaign)

## Notes

`npx tsc --noEmit` still reports pre-existing errors in unrelated
`.next/types` and jest-style API tests; `next build`'s TypeScript pass
succeeded. No schema or env changes. Lookalike seeding still treats 441
as not-ready-for-LAL (`checkAudienceReadiness.ready === false`) — that
is a different write (seed vs ad-set targeting).
