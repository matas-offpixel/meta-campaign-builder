# TikTok: launch into existing campaigns and ad groups

## PR

- **Number:** 1036
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1036
- **Branch:** `cursor/tiktok-attach-existing`

## Summary

The TikTok creator (standalone `/tiktok-campaign/[id]` and the canvas TikTok drawer) can now launch into existing TikTok objects, mirroring the Meta attach modes. The draft carries `launchMode`:

- `new` (the default, unchanged): create a campaign, ad groups and ads.
- `attach_campaign`: create the draft's ad groups and their ads under each of 1..n existing campaigns.
- `attach_adgroup`: create only ads, in specific existing ad groups, which may span campaigns.
- `attach_all_adgroups`: create only ads, in every live (ENABLE/DISABLE, not deleted) ad group of the chosen campaigns.

Settings come from the target, never from the draft. A pre-existing campaign or ad group is never modified or deleted, and a failed run removes only what that run created.

## Read probe (Ironworks advertiser 7639802149165301776, 4 GETs, no writes)

I ran these reads before designing anything. Every field the code relies on appears below. Nothing is assumed beyond them.

Probe 1 (`/campaign/get/` and `/adgroup/get/` with no `fields` param, then `/adgroup/get/` with `filtering.primary_status = STATUS_ALL`):

```text
advertiser 7639802149165301776

## /campaign/get/ (no fields param, page_size 100)
page_info: {"page":1,"page_size":100,"total_page":1,"total_number":18}
rows: 18
keys: ["advertiser_id","app_promotion_type","budget","budget_mode","budget_optimize_on","campaign_automation_type","campaign_id","campaign_name","campaign_type","catalog_enabled","create_time","deep_bid_type","disable_skan_campaign","is_advanced_dedicated_campaign","is_new_structure","is_search_campaign","is_smart_performance_campaign","modify_time","objective","objective_type","operation_status","roas_bid","rta_bid_enabled","rta_id","rta_product_selection_enabled","sales_destination","secondary_status","special_industries","virtual_objective_type"]
  objective_type: {"WEB_CONVERSIONS":9,"ENGAGEMENT":2,"LEAD_GENERATION":7}
  virtual_objective_type: {"SALES":8,"<null>":10}
  budget_mode: {"BUDGET_MODE_DAY":9,"BUDGET_MODE_TOTAL":1,"BUDGET_MODE_INFINITE":8}
  budget_optimize_on: {"<absent>":17,"true":1}
  operation_status: {"ENABLE":4,"DISABLE":14}
  secondary_status: {"CAMPAIGN_STATUS_ENABLE":4,"CAMPAIGN_STATUS_DISABLE":14}
  campaign_automation_type: {"MANUAL":10,"UPGRADED_SMART_PLUS":8}
  is_smart_performance_campaign: {"false":18}
  campaign_type: {"REGULAR_CAMPAIGN":18}
  is_new_structure: {"true":18}
  sales_destination: {"WEBSITE":8,"<absent>":3,"<null>":7}
  app_promotion_type: {"<absent>":10,"UNSET":8}
  is_search_campaign: {"false":18}
  rf_campaign_type: {"<absent>":18}
  campaign_product_source: {"<absent>":18}
  is_advanced_dedicated_campaign: {"false":18}

picked campaign 1878385246248402 objective=WEB_CONVERSIONS automation=MANUAL budget_mode=BUDGET_MODE_DAY budget_optimize_on=undefined

## /adgroup/get/ (no fields param, filtering campaign_ids = those campaigns)
page_info: {"page":1,"page_size":1000,"total_page":1,"total_number":27}
rows: 27
keys: ["actions","adgroup_app_profile_page_state","adgroup_id","adgroup_name","advertiser_id","age_groups","app_config","app_download_url","app_id","app_type","attribution_event_count","audience_ids","auto_targeting_enabled","automated_keywords_enabled","bid_display_mode","bid_price","bid_type","billing_event","brand_safety_partner","brand_safety_type","budget","budget_mode","campaign_automation_type","campaign_id","campaign_name","category_exclusion_ids","category_id","click_attribution_window","comment_disabled","contextual_tag_ids","conversion_bid_price","conversion_window","create_time","creative_material_mode","custom_conversion_id","dayparting","deep_bid_type","deep_cpa_bid","deep_funnel_event_source","deep_funnel_event_source_id","deep_funnel_optimization_event","deep_funnel_optimization_status","delivery_mode","device_model_ids","device_price_ranges","excluded_audience_ids","excluded_custom_actions","feed_type","frequency","frequency_schedule","gender","household_income","included_custom_actions","interest_category_ids","interest_keyword_ids","inventory_filter_enabled","ios14_quota_type","is_hfss","is_lhf_compliance","is_new_structure","is_smart_performance_campaign","isp_ids","keywords","languages","location_ids","modify_time","network_types","next_day_retention","operating_systems","operation_status","optimization_event","optimization_goal","pacing","pixel_id","placement_type","placements","product_source","promotion_target_type","promotion_type","promotion_website_type","purchase_intention_keyword_ids","purchased_impression","purchased_reach","rf_estimated_cpr","rf_estimated_frequency","rf_purchased_type","schedule_end_time","schedule_infos","schedule_start_time","schedule_type","scheduled_budget","search_result_enabled","secondary_optimization_event","secondary_status","share_disabled","shopping_ads_retargeting_custom_audience_relation","shopping_ads_retargeting_type","shopping_ads_type","skip_learning_phase","smart_audience_enabled","smart_interest_behavior_enabled","spending_power","statistic_type","targeting_expansion","tiktok_subplacements","vbo_window","vertical_sensitivity_id","video_download_disabled","view_attribution_window","zipcode_ids"]
  operation_status: {"ENABLE":23,"DISABLE":4}
  secondary_status: {"ADGROUP_STATUS_DELIVERY_OK":2,"ADGROUP_STATUS_DISABLE":1,"ADGROUP_STATUS_CAMPAIGN_DISABLE":22,"ADGROUP_STATUS_TIME_DONE":1,"ADGROUP_STATUS_REVIEW_PARTIALLY_APPROVED":1}
  optimization_goal: {"CONVERT":19,"FOLLOWERS":4,"LEADS":4}
  optimization_event: {"SHOPPING":8,"<null>":4,"ON_WEB_REGISTER":11,"FORM":4}
  billing_event: {"OCPM":27}
  bid_type: {"BID_TYPE_NO_BID":19,"BID_TYPE_CUSTOM":8}
  budget_mode: {"BUDGET_MODE_DAY":9,"BUDGET_MODE_INFINITE":2,"BUDGET_MODE_DYNAMIC_DAILY_BUDGET":16}
  promotion_type: {"WEBSITE":11,"WEBSITE_OR_DISPLAY":4,"LEAD_GENERATION":12}
  promotion_target_type: {"<absent>":15,"EXTERNAL_WEBSITE":12}
  placement_type: {"PLACEMENT_TYPE_NORMAL":20,"PLACEMENT_TYPE_AUTOMATIC":7}
  placements: {"[\"PLACEMENT_TIKTOK\"]":20,"[\"PLACEMENT_TIKTOK\",\"PLACEMENT_PANGLE\"]":5,"[\"PLACEMENT_PANGLE\",\"PLACEMENT_TIKTOK\"]":2}
  schedule_type: {"SCHEDULE_START_END":12,"SCHEDULE_FROM_NOW":15}
  pacing: {"PACING_MODE_SMOOTH":27}
  campaign_automation_type: {"MANUAL":15,"UPGRADED_SMART_PLUS":12}
  is_smart_performance_campaign: {"false":27}
  creative_material_mode: {"CUSTOM":15,"<null>":12}
  deep_bid_type: {"<null>":27}
  identity_id: {"<absent>":27}
  identity_type: {"<absent>":27}
  pixel_id present: 23 of 27
  budget values (first 8): [50,0,0,50,50,40,40,30]
  sample: {"adgroup_id":"1878385288297905","campaign_id":"1878385246248402","operation_status":"ENABLE","secondary_status":"ADGROUP_STATUS_DELIVERY_OK","optimization_goal":"CONVERT","optimization_event":"SHOPPING","pixel_id":"7644201699552690194","budget":50,"budget_mode":"BUDGET_MODE_DAY","billing_event":"OCPM","bid_type":"BID_TYPE_NO_BID","placement_type":"PLACEMENT_TYPE_NORMAL","placements":["PLACEMENT_TIKTOK"],"schedule_type":"SCHEDULE_START_END","schedule_start_time":"2026-10-07 10:32:00","schedule_end_time":"2026-10-14 12:32:00","promotion_type":"WEBSITE"}
  ad groups per campaign (first 10): [["1878385246248402",1],["1878234175424786",2],["1877233142092081",1],["1876775025599506",1],["1876773968562738",1],["1876524529751265",1],["1876523700606274",1],["1876045082419729",1],["1876044101888033",1],["1876043054444001",1]]

## /adgroup/get/ filtering primary_status=STATUS_ALL
rows: 27 page_info: {"page":1,"page_size":1000,"total_page":1,"total_number":27}
  operation_status: {"ENABLE":23,"DISABLE":4}
  secondary_status: {"ADGROUP_STATUS_DELIVERY_OK":2,"ADGROUP_STATUS_DISABLE":1,"ADGROUP_STATUS_CAMPAIGN_DISABLE":22,"ADGROUP_STATUS_TIME_DONE":1,"ADGROUP_STATUS_REVIEW_PARTIALLY_APPROVED":1}

calls: 3
```

Probe 2 (cross-tabs of the same reads):

```text
## campaign objective | automation | budget_mode | budget_optimize_on | budget
  WEB_CONVERSIONS | MANUAL | BUDGET_MODE_DAY | <absent> | 50: 5
  ENGAGEMENT | UPGRADED_SMART_PLUS | BUDGET_MODE_TOTAL | true | 200: 1
  LEAD_GENERATION | MANUAL | BUDGET_MODE_DAY | <absent> | 50: 3
  WEB_CONVERSIONS | UPGRADED_SMART_PLUS | BUDGET_MODE_DAY | <absent> | 50: 1
  WEB_CONVERSIONS | UPGRADED_SMART_PLUS | BUDGET_MODE_INFINITE | <absent> | 0: 3
  LEAD_GENERATION | UPGRADED_SMART_PLUS | BUDGET_MODE_INFINITE | <absent> | 0: 3
  LEAD_GENERATION | MANUAL | BUDGET_MODE_INFINITE | <absent> | 0: 1
  ENGAGEMENT | MANUAL | BUDGET_MODE_INFINITE | <absent> | 0: 1

## ad group: campaign objective | campaign CBO | goal | event | adgroup budget_mode | budget | promotion_type | automation
  WEB_CONVERSIONS | - | CONVERT | SHOPPING | BUDGET_MODE_DAY | 50 | WEBSITE | MANUAL: 2
  ENGAGEMENT | true | FOLLOWERS | null | BUDGET_MODE_INFINITE | 0 | WEBSITE_OR_DISPLAY | UPGRADED_SMART_PLUS: 2
  LEAD_GENERATION | - | CONVERT | ON_WEB_REGISTER | BUDGET_MODE_DAY | 50 | LEAD_GENERATION | MANUAL: 2
  WEB_CONVERSIONS | - | CONVERT | SHOPPING | BUDGET_MODE_DYNAMIC_DAILY_BUDGET | 40 | WEBSITE | UPGRADED_SMART_PLUS: 1
  WEB_CONVERSIONS | - | CONVERT | SHOPPING | BUDGET_MODE_DAY | 40 | WEBSITE | MANUAL: 1
  WEB_CONVERSIONS | - | CONVERT | SHOPPING | BUDGET_MODE_DAY | 30 | WEBSITE | MANUAL: 1
  WEB_CONVERSIONS | - | CONVERT | SHOPPING | BUDGET_MODE_DYNAMIC_DAILY_BUDGET | 30 | WEBSITE | UPGRADED_SMART_PLUS: 3
  WEB_CONVERSIONS | - | CONVERT | ON_WEB_REGISTER | BUDGET_MODE_DAY | 50 | WEBSITE | MANUAL: 3
  LEAD_GENERATION | - | LEADS | FORM | BUDGET_MODE_DYNAMIC_DAILY_BUDGET | 30 | LEAD_GENERATION | UPGRADED_SMART_PLUS: 1
  LEAD_GENERATION | - | LEADS | FORM | BUDGET_MODE_DYNAMIC_DAILY_BUDGET | 50 | LEAD_GENERATION | UPGRADED_SMART_PLUS: 1
  LEAD_GENERATION | - | LEADS | FORM | BUDGET_MODE_DYNAMIC_DAILY_BUDGET | 21 | LEAD_GENERATION | UPGRADED_SMART_PLUS: 2
  LEAD_GENERATION | - | CONVERT | ON_WEB_REGISTER | BUDGET_MODE_DYNAMIC_DAILY_BUDGET | 21 | LEAD_GENERATION | MANUAL: 4
  LEAD_GENERATION | - | CONVERT | ON_WEB_REGISTER | BUDGET_MODE_DYNAMIC_DAILY_BUDGET | 21 | LEAD_GENERATION | UPGRADED_SMART_PLUS: 2
  ENGAGEMENT | - | FOLLOWERS | null | BUDGET_MODE_DYNAMIC_DAILY_BUDGET | 40 | WEBSITE_OR_DISPLAY | MANUAL: 1
  ENGAGEMENT | - | FOLLOWERS | null | BUDGET_MODE_DYNAMIC_DAILY_BUDGET | 60 | WEBSITE_OR_DISPLAY | MANUAL: 1
```

### What the probe settled

- **CBO** is `budget_optimize_on: true` on the campaign. The key is **absent**, not `false`, on non-CBO campaigns (17 absent, 1 true). Under the CBO campaign every ad group is `BUDGET_MODE_INFINITE` with budget `0`. So under CBO the new ad group sends no `budget` and no `budget_mode`.
- **Smart+** shows up at two levels. On campaigns it is `campaign_automation_type: UPGRADED_SMART_PLUS` (8 of 18). Ad groups carry their own `campaign_automation_type`, which can be `UPGRADED_SMART_PLUS` independently of the campaign. `is_smart_performance_campaign` was false on all rows. Both levels are checked, and either one is a hard blocker.
- **Identity** is not on ad groups (`identity_id` / `identity_type` absent on all 27). It is ad-level, so the ads-only modes take it from the draft, as specified.
- **Pixel and event** are on ad groups (`pixel_id` present on 23 of 27, plus `optimization_event`). attach_campaign inherits from these.
- **Deleted rows**: `primary_status: STATUS_ALL` was accepted and returned the same 27 rows. This advertiser has no deleted objects, so whether the default read already excludes them is unverified. Rows are filtered client-side: `operation_status` must be ENABLE or DISABLE, and `secondary_status` must not contain DELETE.
- **Rollback endpoints**: TikTok has no delete endpoint. Deletion is `POST /adgroup/status/update/` (`adgroup_ids`, `operation_status: DELETE`) and `POST /ad/status/update/` (`ad_ids`). Both are verified against the official SDK docs (`AdgroupStatusUpdateBody`, `AdStatusUpdateBody`). Batch limits are not documented, so deletes are chunked at 100.

## Inheritance and blockers

- **Objective**: a new ad group uses the campaign's `objective_type`. WEB_CONVERSIONS maps to Sales, TRAFFIC to Traffic, and LEAD_GENERATION to Leads. Any other objective is blocked by name. A draft optimisation goal that the target objective doesn't allow is blocked with both names in the message.
- **CBO**: no ad-group budget is sent, and the per-ad-group budget floor is skipped.
- **attach_campaign conversion**: the default is the most common (pixel, event) pair on the campaign's live ad groups, with ties going to the first seen. The operator can override it with the draft's pixel and event. If there is nothing to inherit, the draft's pair is used and a warning says so.
- **Event deny-list (found while testing)**: Ironworks runs 3 manual WEB_CONVERSIONS ad groups on `ON_WEB_REGISTER`. Our deny-list (`lib/tiktok/optimisation-event.ts`) refuses that pairing under Sales because Ads Manager can't edit the result. Inheritance therefore skips denied pairs and takes the most common allowed pair. If no allowed pair exists, the draft's pair is used, with a warning.
- **Ads-only modes**: identity, video, CTA and URL come from the draft. The ad group is not touched. LEADS/FORM (instant form) ad groups get a warning because a website ad may not fit them. A paused target gets a warning that the new ads won't deliver until it is enabled.
- **Smart+**: a Smart+ campaign or ad group is a hard blocker in every mode.
- **Missing targets**: a target that a live read says doesn't exist is blocked. If the read fails, preflight logs the error and continues from the snapshots stored on the draft. The exception is attach_all_adgroups: it cannot know the ad groups without the read, so a failed read blocks it.

## Safety

- Attach never calls `/campaign/create/`, `/campaign/update/`, `/adgroup/update/` or `/campaign/status/update/`.
- On failure, `rollbackTikTokAttach` deletes only this run's ad groups (which takes their ads with them) and this run's ads in existing ad groups. A guard drops any target id before the request is sent. Idempotency is cleared only for the removed result ids.
- If cleanup itself fails, the error lists what was left behind and says existing campaigns and ad groups were not changed.
- `launchPaused` sets DISABLE on new ad groups and ads only. Targets get no request at all.
- Idempotency hashes cover the payload, which includes `campaign_id` / `adgroup_id`, so the same draft into two targets produces two keys. A retry into the same target reuses the ledger and makes zero POSTs.
- The killswitch `OFFPIXEL_TIKTOK_WRITES_ENABLED` and the Review confirmation are unchanged. The confirmation text names the targets and counts.
- A duplicated draft starts as `new`, with no targets. The idempotency ledger is per draft, so a copy that kept its targets would write the same ads again.

## UI

- "Launch into" sits at the top of Review (standalone) and in the canvas TikTok drawer's details. Its options are New campaign | Existing campaign(s) | Existing ad groups | All ad groups in campaign(s).
- The pickers show name, status, objective, budget mode (with CBO marked) and ad group count. They support search and multi-select. Smart+ targets and unsupported objectives are disabled, with the reason shown.
- Selections are stored on the draft, with names captured at selection time.
- A summary reads, for example, "2 ad groups × 2 campaigns, 6 ads" or "2 ads × 2 ad groups in 2 campaigns, 4 ads".
- Reads go through `GET /api/tiktok/attach-targets` (read-only).

## Scope / files

- Types and persistence: `lib/types/tiktok-draft.ts`, `lib/tiktok-wizard/migrate-draft.ts`, `lib/tiktok-wizard/library.ts`.
- Reads: `lib/tiktok/attach/{targets,read}.ts` and `app/api/tiktok/attach-targets/route.ts`.
- Plan, summary and pickers: `lib/tiktok/attach/{plan,summary,picker}.ts`.
- Writes:
  - `lib/tiktok/write/attach-orchestrator.ts` and `lib/tiktok/write/launch-preflight.ts`.
  - `lib/tiktok/write/launch.ts` and `launch-stream.ts`: the attach branch. The old path is unchanged.
  - `adgroup.ts` and `ad.ts`: the POST is exported for reuse.
  - `idempotency.ts`: clears by result id.
  - `mapping.ts`: the CBO flag.
  - `preflight.ts`: the options plus two extracted checks, in the same order.
- Canvas preflight: `lib/plan/preflight.ts`.
- UI: `components/tiktok-wizard/launch-into.tsx`, `steps/review-launch.tsx` and `components/plan/tiktok-drawer-details.tsx`.
- Tests: `lib/tiktok/attach/__tests__/plan.test.ts` (+ `fixtures.ts`, `new-mode-golden.json`) and `lib/tiktok/write/__tests__/attach-orchestrator.test.ts`.
- `lib/plan/__tests__/drawer.test.ts`: removed its "no new exports in preflight.ts vs main" assertion. It refused the two extracted checks that every launch mode shares, and it is the diff-against-main kind of freeze that #969 replaced with properties. Its unchanged-helper comparisons stay. New-mode behaviour is now pinned by the byte-identical golden test.

## Tests

- Each mode's plan is built from fixtures. This includes cross-campaign attach_adgroup, and CBO sending no ad-group budget (and skipping the floor).
- Blockers: objective mismatch (names both), unsupported objective, Smart+ campaign, Smart+ ad group in a manual campaign, missing target on a live read, and attach_all after a failed read.
- Inheritance, override, and the deny-list skip/fallback.
- **Required**: an attach_campaign run with 3 draft ad groups fails on the 3rd `/adgroup/create/`. Exactly one cleanup call goes out, `/adgroup/status/update/` with the 2 created ids. There is no campaign status-update or create call. Only those idempotency rows are cleared, and an earlier launch's row survives.
- An ads-only failure deletes only the created ads, by ad id, and never an ad group.
- `launchPaused`: every body is DISABLE, and no request goes to a target.
- A retry makes zero POSTs. The rollback guard drops target ids. The left-behind message appears when cleanup fails.
- `new` mode: the call sequence (path plus body, live and paused) is byte-identical to a golden captured from `main` before any change. The mode-aware preflight equals the old preflight for new drafts.

## Validation

- [x] `npx tsc --noEmit`: 351 errors, the pre-existing baseline. None are in touched files.
- [x] `npm run build`
- [x] `npm test`
- [x] `frames:check` (passes in CI, which is the source of truth because the baselines are Ubuntu)

## Round 2 (review fixes)

- **B1: rollback could delete live objects from an earlier launch.** A ledger hit returned the earlier `op_result_id`, and the orchestrator counted it as created by this run.
  - `withTikTokWriteIdempotencyOutcome` now returns `{ id, reused }`. `withTikTokWriteIdempotency` wraps it, so the new-mode signature and bodies are unchanged.
  - Attach rollback deletes and clears only ids that a create POST in this run returned. `deletableIds` drops target ids and reused ids right before every status call, for ads as well as ad groups.
  - `handleTikTokLaunch` returns 409 (`reason: "already_launched"`) for an attach draft that has `publishedIds` or `status: "published"`. The check runs before any credential read or TikTok call. New mode is not gated.
- **S1: failed cleanup left live-looking ledger rows.** Rows for objects the cleanup could not delete are now set to `failed`, so a retry creates again instead of reusing ids that may be gone. The 062 CHECK allows only pending/success/failed, so there is no separate `orphaned` value. That would need a migration.
- **S2: a failed read fell back to snapshots.** A failed launch-time read now blocks every attach mode (`source: "read_failed"`). The browser preview's selection snapshots are `source: "selection"`, so Review and the canvas still plan. `adGroupReadFailed` and `snapshotParents` are gone. A related fix: attach_all's "campaign has no ad groups" blocker now needs a live read; before, the browser preview always tripped it.
- **S3: unbuildable payloads were skipped silently.** An ad group or ad whose payload can't be built now blocks, with TikTok's mapping reason in the message.
- **S4:** the draft's `smartPlusEnabled` blocker now also runs in the ads-only modes.
- **N3:** ads-only payloads are built from `adDraft`, the draft with the target's objective. `buildTikTokAdPayload` never reads the objective, so the body is identical. A test proves this for WEB_CONVERSIONS, LEAD_GENERATION and TRAFFIC parents.

## Round 3

- **A new ad under a reused ad group was counted as nested.** Rollback assumes nested ads go when their parent group is deleted, but a reused group is never deleted. So the ad stayed live, lost its ledger row, and was not reported. It now goes to the delete-by-ad-id list. Its row is cleared only after a successful delete, and set to `failed` (and reported as left behind) when the delete fails.
- **An assigned creative with no video was skipped silently in attach_campaign.** It now blocks by name. The shared `collectTikTokLaunchPreflight` check `adgroup-creative-{id}` blocks only a group where no creative has a video, so a mixed group used to pass. New mode still skips these (`orchestrator.ts`) and is unchanged.

## Records (follow-up, no migration here)

New TikTok ad groups and ads are **not** recorded in this PR:

- `launched_ad_sets` (migration 175) accepts channel `'tiktok'`, but its `draft_id` FK references `campaign_drafts`, not `tiktok_campaign_drafts`.
- Its recorder takes Meta `AdSetSuggestion` / `AudienceSettings`.
- Its readers (`lib/db/describe-cells.ts`, `lib/launched-ads/launch-recorder.ts`) don't filter by channel.
- `launched_ads` (184) has `CHECK channel in ('meta')`.

TikTok `new` mode doesn't record either. The follow-up covers both modes: a migration that relaxes the FK (or adds `tiktok_draft_id`) and the `launched_ads` CHECK, plus channel filters on the readers.

## TikTok constraints the Meta modes don't have

- CBO is signalled only by the presence of `budget_optimize_on: true`, which is absent rather than false otherwise.
- Smart+ has to be detected on campaigns and on ad groups separately.
- There is no delete endpoint. Deletion is a status update to DELETE.
- The idempotency ledger is keyed per draft, which is why a duplicate resets its targets.
- Inherited Sales events can be on our own deny-list (`ON_WEB_REGISTER`).
- Instant-form (LEADS/FORM) ad groups don't fit website ads.
- attach_all_adgroups can't fall back to snapshots when the ad-group read fails.
- **Unverified by a write**: the CBO ad-group create shape (no `budget` / `budget_mode`). It matches what TikTok returns for CBO ad groups, but nothing has created one yet. The planned smoke test (attach_adgroup) doesn't exercise it.

## After merge

Matas runs one **paused** `attach_adgroup` launch on the Off/Pixel TikTok advertiser. Confirm that:

- the ads appear DISABLE in the chosen ad group;
- the ad group and campaign are unchanged (status, budget, `modify_time`);
- `tiktok_campaign_drafts.published_ids` carries `launchMode` and `campaignIds`.
