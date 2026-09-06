[Use Opus]

# Plan v2 — closing sprint. Four PRs in order, one branch each, off fresh `main` (246123a). Nothing merges itself.

Same rules as the build sprint: read `docs/CAMPAIGN_PLAN_V2_CANON_2026-09-05.md` and the frames `docs/Paid Media Plan v3.dc.html` first; every visible string is theirs; test the view function the surface calls, not the helper; no writes to Meta/TikTok/Google; no `evaluate.ts` edits; session log per PR in the #893 shape; do not poll CI; do not merge.

## PR A — `cursor/plan-v2-identity-account` — G30: the identity sentence names an account the campaign is not in

Production fact (2026-09-06): D.O.D's live plan (299dd4e5) launched its Meta campaign `120251576269510755` on **act_606252931141334** (the NX Promoter account — the linked draft's `settings.adAccountId`), while the plan's resolver returns the client default **1073273492854557** (ELECTRIC STUDIOS SHEFFIELD). Meta confirms the campaign is not in 1073…. So the LAUNCH/ADJUST identity sentence on the one live plan reads `Running as ELECTRIC STUDIOS SHEFFIELD on Meta` and that is false.

Ruling: identity prints the account the campaign actually runs on.

1. **Launched plan:** the Meta identity is the linked draft's `settings.adAccountId` (via the launch ledger's `draft_id`), never the resolver. Same for TikTok/Google ledgers where a draft exists. Store it on the ledger at launch too — add `platform_ad_account_id text` to `campaign_plan_meta_launch` / `_tiktok_launch` / `_google_launch` (migration 169, part 1) and write it in the live upsert; backfill from the linked drafts' `settings.adAccountId` in the migration.
2. **Draft plan:** `lib/clients/channel-defaults.ts` prefers `events.meta_ad_account_id` when set, then the client default. The ⓘ shows the other when they differ (`client default act_1073273492854557`).
3. Name resolution unchanged (`Running as <name>` or the id when unresolved).

Tests: a D.O.D-shaped fixture (draft on 606…, client default 1073…) renders `Running as <606's name or act_606252931141334> on Meta` after launch; a draft on an event with `meta_ad_account_id` set resolves to it; the ⓘ names the other. Ship the docs first as commit 1 of this branch: `git add docs/session-logs/plan-v2-sprint-report-2026-09-06.md docs/session-logs/plan-v2-sprint-review-2026-09-06.md docs/session-logs/plan-v2-sprint-review-round2-2026-09-06.md docs/session-logs/plan-v2-sprint-review-round3-2026-09-06.md docs/session-logs/plan-v2-closing-sprint-2026-09-06.md`.

## PR B — `cursor/plan-v2-launched-at` — a real launch timestamp

`planLaunchStamp` reads `campaign_plan_meta_launch.created_at`, which is written at prepare-draft; on D.O.D that is 26 Aug 13:51 UTC, not the launch. Migration 169 (part 2, same file as PR A's column or a 170 — one migration per PR, so make this **170**): `launched_at timestamptz` on the three ledger tables; the live upsert (`lib/plan/persist.ts` `upsertPlanLaunchRow`) writes `launched_at = now()` on the transition to `live` and never overwrites it. Backfill: for rows already `live` with `launched_at null`, set it from `campaign_plans.start_time` (the launch wrote the window start), and the ⓘ on the header says `launch time taken from the plan's start` for those rows (a `launched_at_source` text column: `ledger` | `plan_start`). `planLaunchStamp` reads `launched_at`; `created_at` is never a launch time again. ADJUST/LEARN windows (`sinceDate`) read the same. Tests: idle row → null; live row with `launched_at` → the stamp; backfilled row → the ⓘ sentence.

Matas applies 169 and 170 to prod after review; the PRs open as drafts titled `[needs migration apply]`.

## PR C — `cursor/plan-v2-show-close` — prediction actuals at show close

`campaign_plan_predictions.actual` is written at archive only. Add the show-close write to `/api/cron/rollup-sync-events`: for every live plan whose event's `event_date` is yesterday or earlier (London) and whose prediction rows have `actual_at null`, compute the plan-window actual in the launch unit (`launch-ledger day → event_date`, same reader LEARN uses — `loadPlanWindowActual` with `untilDate = event_date`) and write it once with `closed_reason: 'show'`. Idempotent (the `actual_at null` filter), DB-only, no platform calls, respects the cron's existing budget. Tests: a plan with the show yesterday gets its actual; a second run writes nothing; a plan archived first keeps `archived`.

## PR D — `cursor/plan-v2-share-parity` — the share link (canon §1.6)

The client share link opens one plan, never the list; renders LAUNCH (read-only), ADJUST and LEARN under `role=client` with the same components; no switcher, no marker — the absence of controls is the marker. Every control absent under the share role (suggestion, do it / not now, undo, unit picker, drawers' edit affordances, Launch); every exhibit present; `VIZ_CLIENT_SAFE` on every system sentence; the share route is in `PUBLIC_PREFIXES` only if it already is — do not widen the proxy allow-list. Tests per face.

## Not code — for Matas

Junction 2's tickets: there was never a ticketing connection or a `ticket_sales_snapshots` row for Junction 2 — the 9 Feb → 20 Apr weekly numbers were entered straight into the rollups and stopped. The five shows have passed. Get the final ticket counts from Junction 2 and enter them as manual snapshots (source `manual`) so the per-ticket benchmark reads to the show, not to April; G33's `source not recorded` then becomes `you entered`. Ops ask, not a PR.

Merge order: A → B (after 169/170 applied) → C → D. Report at `docs/session-logs/plan-v2-closing-sprint-report-2026-09-06.md`.
