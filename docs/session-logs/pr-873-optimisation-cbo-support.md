# Session log

## PR

- **Number:** 873
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/873
- **Branch:** `cursor/optimisation-cbo-support`
- **Parent sha:** `6eed75b` (`feat(meta): parse business-use-case usage… (#872)`)

## Summary

Task #120 follow-on: CBO campaigns evaluate once at campaign grain (Meta-reported campaign `daily_budget` + campaign Insights, same Optimisation Strategy ladder) instead of writing a no-op per ad set. Lifetime budgets are a named skip. Apply writes the campaign object behind the existing three gates. Shadow-first.

## Scope / files

- `lib/optimisation/evaluate.ts` — `evaluateCampaign` / `campaignGuardrails` / named skip strings
- `lib/optimisation/insights-fetch.ts` — `fetchCampaignBudgetInsights`, `isCboAdSetRoster`, `lifetimeBudgetPence`
- `lib/optimisation/tick-runner.ts` — CBO roster → one `buildCampaignDecision`
- `lib/optimisation/apply.ts` — `scope === "campaign"` writes campaign `daily_budget`
- `lib/db/campaign-automation-decisions.ts` + `lib/db/campaign-automation.ts` — persist / read `scope` (retry if 164 unapplied)
- `supabase/migrations/164_campaign_automation_decisions_scope.sql` — **not applied**
- `components/viz/scope-glyph.tsx` + decisions list glyph
- Tests: `cbo.test.ts` plus apply / evaluate / insights / tick-runner updates

## Inventory

### 1. How the tick detected CBO (before)

`lib/optimisation/tick-runner.ts` `buildDecision`: if `row.dailyBudgetPence === null` → `maintain`, `metric_value` null, reason

`Ad set "…" has no per-ad-set daily_budget (campaign budget optimisation) — PR A does not propose CBO changes.`

That early return is gone for campaigns we now evaluate. Detection is now `isCboAdSetRoster(rows)` — every ad set lacks `daily_budget`. Those campaigns take `buildCampaignDecision` and `continue` (no per-ad-set CBO no-ops). Leftover ABO rows with no daily still skip, named: lifetime ad-set skip, or `unsupportedNoDailyBudgetReason` (campaign is not using campaign-level daily budget).

### 2. Campaign-level budget source

**Not read anywhere before this PR.** `lib/meta/campaign.ts` has no `daily_budget` / `lifetime_budget`. Wizard `createMetaCampaign` always sets `is_adset_budget_sharing_enabled: false` (ABO). CBO in this account base is Ads Manager / draft `budgetLevel === "campaign"`.

Graph fields (added): campaign `GET /{campaignId}?fields=id,daily_budget,lifetime_budget,insights.date_preset(...){impressions,cpc,cpm,ctr,actions,cost_per_action_type}`. Minor units.

### 3. Insights grain

Existing fetch is **ad-set** via `/{campaignId}/adsets` nested insights. `cost_per_action_type` is a **rate** — summing ad-set rows would be a dishonest denominator. CBO uses **Meta’s campaign-grain Insights row**, not a sum.

### 4. Lifetime in prod (queried 2026-09-01)

Draft `budgetSchedule`:

| budgetType | budgetLevel | drafts | opted-in | published |
|---|---|---|---|---|
| daily | ad_set | 129 | 3 | 75 |
| daily | campaign | 5 | 1 | 5 |
| lifetime | campaign | 2 | **0** | 2 |

No opted-in lifetime campaigns. Named skip anyway:

`Campaign uses a lifetime_budget — daily-percentage rules cannot scale a lifetime budget.`

Never convert lifetime → daily.

## Base / ceiling (CBO)

From the draft Optimisation Strategy, **campaign-level**, not the sum of ad-set bases:

- Base: `guardrails.baseCampaignBudget` (major units → pence)
- Hard ceiling: `guardrails.hardBudgetCeiling`
- Expansion cap: `base * (1 + maxExpansionPercent / 100)`
- `maxSingleAdSetBudget` is **stripped** on this path (`campaignGuardrails()`)
- `maxDailyIncreasePercent` still applies

## Scope column

`campaign_id` already exists. Added nullable-in-practice `scope text not null default 'ad_set'` in migration **164** (not applied). CBO rows set `adset_id = campaign_id` so `idx_cad_adset_decided` still keys one target. `apply.ts` writes campaign `daily_budget` when `scope === "campaign"`. Pause stays recommend-only. Same three gates — no new killswitch.

## Before / after decision counts (DOD / IPC shapes)

Prod `campaign_automation_decisions` (2026-09-01): **204** rows.

| Campaign | Prod rows | Honest shape | Before (per tick) | After (per tick) |
|---|---|---|---|---|
| `[NX26-DOD] DOD - Signup - Artist` | 44 (33 CBO no-ops; 11 ad sets × ~3 ticks) | CBO — ad sets have no `daily_budget` | 11 `maintain` / null metric / “PR A does not propose CBO changes” | **1** campaign-level decision (`lpv_cost` when Meta reports it) |
| `IPC - NEWCASTLE - SIGNUP v4` | 130, all `maintain` + null metric | **ABO** — ad sets **have** `daily_budget`; reason is `No cpr data in the 24h window` | unchanged | unchanged (not CBO) |
| DJ EZ Traffic | 30 real ABO evals | ABO | unchanged | unchanged |

User lumped IPC with DOD. IPC is insufficient CPR data, not the CBO early-return. This PR does not invent a rate for IPC.

Fixture (DOD/IPC-shaped CBO: 3 ad sets, no daily, campaign daily £150, lpv £0.18): 1 `scale_up` +15% → £172.50, `dry_run`.

## Validation

- [x] `npx eslint` on touched files — clean
- [x] `npx tsc --noEmit` — no new errors in this diff
- [x] `npm run build`
- [x] `npm test` — **4745** tests, **4742** pass, **0** fail, **3** skipped
- [x] Parent-sha falsify: `6eed75b` still early-returns CBO as PR A no-op and has no `fetchCampaignBudgetInsights`

## Notes

- Cross-channel rows stay `CROSS_CHANNEL_SHADOW_GATES`.
- Insufficient CBO data → `metric_unavailable` + M.4 wording (`not a guessed rate`).
- Migration 164 is not applied; insert/select retry without `scope`.
- Glyph on the #857 list was not browser-verified (auth-gated published-campaign surface).
