# Session log

## PR

- **Number:** 845
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/845
- **Branch:** `cursor/plan-d0`

## Summary

Phase D.0 prerequisites for the plan spine: verify paused-everywhere on the real launchers, add a Meta `createPaused` parameter that leaves standalone-wizard ACTIVE behaviour unchanged, and add an additive `meta_write_idempotency` ledger (migration 156, not applied) that no-ops when the table is absent.

## Scope / files

- `lib/meta/launch-status.ts` — `resolveMetaLaunchEntityStatus`
- `lib/meta/write-idempotency.ts` — ledger wrap + clear-on-rollback primitive
- `lib/meta/adset.ts` / `lib/meta/creative.ts` — optional `entityStatus` (default ACTIVE)
- `app/api/meta/launch-campaign/route.ts` — `createPaused` body flag, ledger-wrapped creates
- `supabase/migrations/156_meta_write_idempotency.sql` — not applied
- Tests: `launch-active-by-default`, `paused-everywhere-audit`, `write-idempotency`

## Inventory

- **Meta** launched ACTIVE (campaign route, `buildAdSetPayload`, `buildAdPayload`). Confirmed.
- **TikTok** `operation_status: DISABLE` on campaign / ad group / ad. Confirmed; no behaviour change.
- **Google** campaign / ad group / RSA `PAUSED` in `campaign-writer.ts`. Keywords ENABLED (cannot spend without parent). Confirmed; no behaviour change.
- Real Google launcher is `POST /api/google-search/[id]/push`, not the stub `POST /api/google-ads/launch`.
- TikTok ledger: draft-scoped `(draft_id, op_kind, op_payload_hash)`, service-role RLS, cleared on rollback. Meta mirrors that; `event_id` is nullable because `campaign_drafts.event_id` is optional.
- Meta launch has no rollback today. `clearMetaWriteIdempotency` is the TikTok-parity primitive; it is not invoked because there is no Meta delete/rollback path.

## Validation

- [x] `npm test` — 4427 pass, 0 fail, 3 skipped
- [x] D.0 files lint: 0 errors (7 pre-existing unused-var warnings in launch-campaign/adset/creative)
- [x] `npm run build` — compiled successfully
- [x] Next build TypeScript pass (raw `tsc --noEmit` is dirty on main: jest test files + `.next/dev` validator)

## Notes

- Falsification: `paused-everywhere-audit` PAUSED builder + route-wiring cases failed against parent `d012c7f` before the launch-route / builder wiring (ACTIVE !== PAUSED; route lacked `createPaused`).
- Wizard callers omit `createPaused`; default remains ACTIVE.
- Ledger uses service-role client (TikTok parity). Missing table / missing service role / unpersisted draft FK → named warn, proceed as today.
