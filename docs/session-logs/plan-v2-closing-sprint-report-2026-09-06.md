# Plan v2 closing sprint — report

**Date:** 2026-09-06 · **Base:** `246123a` (LEARN #898) · **Nothing merged.**

Four PRs, one branch each, off fresh `main`. Merge order: **A → B (after 169/170 applied) → C → D**.

## PRs

| PR | Branch | SHA | Status |
|---|---|---|---|
| [A #899](https://github.com/matas-offpixel/meta-campaign-builder/pull/899) identity account | `cursor/plan-v2-identity-account` | `b1815f2` | draft — `[needs migration apply]` 169 |
| [B #900](https://github.com/matas-offpixel/meta-campaign-builder/pull/900) launched_at | `cursor/plan-v2-launched-at` | `fc13396` | draft — `[needs migration apply]` 170 |
| [C #901](https://github.com/matas-offpixel/meta-campaign-builder/pull/901) show-close | `cursor/plan-v2-show-close` | `fbd82d9` | open |
| [D #902](https://github.com/matas-offpixel/meta-campaign-builder/pull/902) share parity | `cursor/plan-v2-share-parity` | *this branch* | open |

Matas applies **169** then **170** on prod after review. Do not merge A or B until those are on the database.

## What each PR does

**A — G30.** After launch, identity is the ledger's `platform_ad_account_id` (the linked draft's `settings.adAccountId`), never the client-default resolver. D.O.D was printing ELECTRIC STUDIOS SHEFFIELD while the campaign runs on NX Promoter (`act_606252931141334`). Drafts prefer `events.meta_ad_account_id`; the ⓘ names the other.

**B — a real launch timestamp.** `planLaunchStamp` reads `launched_at`, written once on the transition to live. `created_at` is prepare-draft (D.O.D: 26 Aug 13:51 UTC) and is never a launch time again. Live rows already in prod backfill from the plan window start; the header ⓘ says `launch time taken from the plan's start`.

**C — prediction actuals at show close.** `/api/cron/rollup-sync-events` stamps `campaign_plan_predictions.actual` once (`closed_reason: 'show'`) for live plans whose event date is yesterday or earlier (London) and whose rows still have `actual_at` null. Same reader LEARN uses. Idempotent, DB-only. Archive-first keeps `archived`.

**D — share-link parity (§1.6).** `/share/plan/[id]` opens one plan, never the list. Same components under `role=client`. No switcher, no marker. Launch, unit picker, drawer edit, suggestion / do it / not now / undo are absent. Exhibits stay. `VIZ_CLIENT_SAFE` on system sentences. `PUBLIC_PREFIXES` unchanged.

## Ops — not a PR

Junction 2 never had a ticketing connection or a `ticket_sales_snapshots` row. The 9 Feb → 20 Apr weekly numbers were entered straight into the rollups and stopped. The five shows have passed. Get the final ticket counts from Junction 2 and enter them as manual snapshots (`source: manual`) so the per-ticket benchmark reads to the show, not to April. G33's `source not recorded` then becomes `you entered`.
