# Backfill `destination_type` on live ad sets

**Branch:** `cursor/backfill-adset-destination`
**PR:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1004 (#1004)
**Date:** 2026-09-30
**Depends on:** #1003 (`cursor/destination-type-website-default`) — must merge after it.

## Why

#1003 fixed the default so every new launch on a website-bound objective sends
`destination_type: WEBSITE`. It does nothing for ad sets that are already live.
A live read across every published campaign found **601 ad sets on 64 campaigns**
reading back `UNDEFINED`, **95 of them delivering right now**. Those are the ad
sets an operator has to hand-edit in Ads Manager today, and the ones a client
sees when they open the ad and find a destination the launcher never chose.

This PR is the operator action that fixes them in place, without relaunching.

## The three live update checks

The brief said to verify before building, and to say so plainly if Meta refused.
A working `META_ACCESS_TOKEN` was present, so all three were made against real
Meta (Graph v21.0, 2026-09-30).

| Check | Ad set | Before → after | Meta response |
| --- | --- | --- | --- |
| Paused ad set, real change | `120251994691920755` (probe) | `UNDEFINED` → `WEBSITE` | `{"success": true}` |
| Running ad set, no-op rewrite | `120249957259130453` (DHB Primary 2) | `WEBSITE` → `WEBSITE` | `{"success": true}` |
| **ACTIVE ad set, real change** | `120249993287300453` (`[DHB26-RELEASE]`, GBP 0.23 / 40 impressions) | `UNDEFINED` → `WEBSITE` | `{"success": true}` |

**Meta accepts `destination_type` on an update of a running ad set.** The
operator-switches-the-radio-by-hand fallback the brief described is not needed.

The ACTIVE write also left `learning_stage_info.last_sig_edit_ts` unchanged,
read back immediately after — Meta did not treat it as a significant edit, so
this does not reset the learning phase. That is why this control carries no
learning-phase warning, unlike #989's audience push, which does.

## What this adds

A **"Set website destination"** button on each published Campaign Library row,
next to #989's audience push and behind the same gate.

- `lib/meta/adset-destination-copy.ts` — client-safe operator copy.
- `lib/meta/adset-destination-write.ts` — read-merge-write for one scalar field.
  Genuine reuse of #989: it imports `META_OBJECT_ID` and `deadReason` from
  `adset-targeting-write.ts` rather than restating the refusal rules, and
  re-exports that module's gate function so the two controls can never drift
  onto different switches.
- `app/api/meta/adset-destination/route.ts` — session auth, draft ownership,
  `commit: false` plans and `commit: true` writes.
- `components/library/adset-destination-push.tsx` — two-step dialog. The write
  button stays disabled until a plan has been fetched and at least one selected
  ad set would actually change.
- `supabase/migrations/180_meta_write_idempotency_adset_destination.sql` — the
  only migration, and only for the new `op_kind` in the ledger CHECK.
  **Matas applies.** Numbered after main's current highest (179).
- `lib/meta/__tests__/helpers/memory-ledger.ts` — #989's in-memory
  `meta_write_idempotency` stub, lifted out of its test file so both write
  modules are tested against the same ledger fake rather than two subtly
  different ones. `adset-targeting-write.test.ts` now imports it; its 14 tests
  still pass unchanged.

## What it writes

`POST /{adset_id}` with exactly `{ destination_type: "WEBSITE" }`. Nothing else.
No targeting, no budget, no status. The read is
`fields=name,destination_type,effective_status,campaign_id`, a field list on an
existing read — no new write helper, per the #969 write-set guard.

Ledgered on `meta_write_idempotency` as `adset_destination_update`, keyed on
`{adset_id, destination_type}`, `required: true` — so if the migration is
unapplied the insert fails the CHECK and the action refuses **before** reaching
Meta rather than writing an unrecorded change. There is a test for that.

## Refusals

Reused from #989 rather than reimplemented: not a Meta id, read threw, read
returned nothing, read missing status or campaign, ad set on a different
campaign than the published draft's, and `ARCHIVED` / `DELETED` via `deadReason`.
Added on top: an ad set already on `WEBSITE` is reported as a no-op and is never
POSTed. One refusal never stops the rest of the batch.

The gate is `OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED` — the same switch as
#989, not a new one. When it is off the button is visible and disabled, the
route returns 403 on `commit`, and `applyAdSetDestinationChanges` refuses every
ad set without reading or writing anything.

## The live backfill list

Delivering ad sets reading `UNDEFINED` on a website-bound objective, as of
2026-09-30:

| Campaign | Objective | Meta campaign | Delivering ad sets on `UNDEFINED` |
| --- | --- | --- | --- |
| [NX26-AZYR] Azyr b2b PB69 - On Sale | `initiate_checkout` | `120251882111960755` | 12 |
| [NX26-SCHAK] SCHAK On Sale v2 | `initiate_checkout` | `120251973670200755` | 11 |
| Modern Funktion — Traffic | `traffic` | `120251191631740755` | 8 |
| Puzzle - Circuit - 17 Oct - SALES | `initiate_checkout` | `120247839447720539` | 8 |
| Jamie Jones — Pre-announce | `purchase` | `52511265606707` | 6 |
| Modern Funktion — Traffic (Copy) (Copy) | `traffic` | `120251647467520755` | 6 |
| [20261003CS] Colyn —Traffic | `purchase` | `120250042840750708` | 6 |
| [IRW0001] Jamie Jones - Signups v2 (Copy) | `purchase` | `52510624318707` | 5 |
| [NX26-FOLAMOUR] Folamour - Signup (Copy) | `purchase` | `120251762963490755` | 5 |
| Jamie Jones — Awareness | `awareness` | `52510629718107` | 4 |
| Mall Grab - Sheffield - Traffic | `traffic` | `120249856769020239` | 4 |
| [IRWOHD] Purchase | `purchase` | `52530289109907` | 4 |
| Puzzle - Circuit - 17 Oct - TRAFFIC | `initiate_checkout` | `120247546058340539` | 3 |
| [20261204CSA] Woraklis — Purchase | `purchase` | `120250383002330708` | 3 |
| [IRW0004] Camelphat — Awareness | `awareness` | `52512868723907` | 3 |
| [20261003CS] Colyn —Sign Up V2 | `registration` | `120249870554700708` | 2 |
| mina galan | `traffic` | `120243165864160080` | 2 |
| IPC - NEWCASTLE - SIGNUP v4 (Copy) | `purchase` | `120251360961960755` | 1 |
| Innervisions — Pre-announce | `purchase` | `120243009748660342` | 1 |
| Mall Grab - Sheffield — Reach | `awareness` | `120249633201480239` | 1 |

Total: **95 delivering ad sets across 20 campaigns**, out of **601 ad sets on 64 campaigns** once paused ones are included (243 ad sets already read back `WEBSITE`).

Nothing here is changed by this PR. The list is what the new action is for.

## Guards honoured

- One migration, and only for the ledger `op_kind` CHECK. Matas applies.
- No new Meta write helper — `graphPostWithToken` and the existing ad-set read.
- `lib/tiktok/**`, `lib/optimisation/**`, `lib/google-ads/**`,
  `lib/google-search/**` untouched.

## Validation

- `npm test` — 6,506 tests, 6,503 pass, 0 fail, 3 skipped (the 3 skips are
  pre-existing). 24 of those are new in
  `lib/meta/__tests__/adset-destination-write.test.ts`.
- `npm run build` — green.
- `npx tsc --noEmit` — no errors in any file this PR touches. The suite's
  pre-existing errors on `main` (missing `@types/jest`, stale `LaunchSummary`
  fixtures) are unchanged.
- `npm run lint` — no findings on any file this PR adds or modifies.
