# Bulk-attach new asset uploads across multiple existing campaigns

**Drafted:** 2026-06-04 evening, after PRs #533→#541 landed.
**Trigger:** Matas needs to add new video/static assets across multiple already-live campaigns at once. Today's "Open campaign creator" attaches one campaign at a time.
**Target session:** Tomorrow morning, lower API traffic = lower rate-limit risk on test runs.

## User intent (from AskUserQuestion, 2026-06-04)

- Asset shape: **NEW uploads** (video + image), not existing posts
- Selection mode: **Multi-select from the existing live-campaigns list** (the screen at `/internal/clients/[id]/events/[id]/campaigns` or wherever the screenshot came from)
- Granularity assumption (to confirm with Matas at session start): replicate the new ad(s) across **ALL ad sets within each selected campaign**, not per-ad-set picking. Faster build; matches the agency workflow of "I made 3 new variations for the J2 series, drop them across all 5 campaigns."

## Today's UI baseline (verified via screenshot)

- Live-campaigns picker exists; shows compatibility filtering ("Compatible campaigns can be selected; the rest are shown greyed-out so you know they exist")
- Single-select today
- Filter pills: Relevant / All; search box
- Per-campaign metadata: code, name, objective, Meta campaign ID, last updated

## Out of scope

- Picking specific ad sets within a campaign (use "all ad sets in campaign" as the v1 default)
- Mixing existing posts + new uploads in one bulk action
- Creating new ad sets (only ATTACHES to existing ones)
- Updating ads already attached (only ADDS new ones)
- TikTok / Google Ads (Meta only)
- Cross-account: must all live under the same ad account

## Architecture sketch

### UI changes

1. **Convert single-select to multi-select** in the campaign picker. Checkboxes left of each campaign card.
2. **Persist selection state across "Load more" pagination** — don't lose checks when scrolling.
3. **Add a footer bar** showing "N campaigns selected · M total ad sets · Continue".
4. **New wizard page** after selection: a stripped-down asset upload + caption + CTA step (no audiences, no budget, no scheduling — those come from the existing ad sets).
5. **Review step**: shows a matrix "Asset × Campaign" with row count = N campaigns × P new ads. Confirm to launch.

### Backend changes

1. **New route**: `POST /api/meta/bulk-attach-ads`
   Body shape:
   ```ts
   {
     adAccountId: string;
     metaCampaignIds: string[];     // user's multi-select
     newCreatives: AdCreativeDraft[]; // standard wizard creative shape
     // No audiences, budget, schedule — borrows from existing ad sets
   }
   ```
2. **Implementation**:
   - For each `metaCampaignId`, fetch ad sets via `/{campaign_id}/adsets?fields=id,name,status`
   - For each ad set, create new ads using existing `uploadVideoAsset` / `uploadImageAsset` + `createMetaCreative` + `createMetaAd` primitives
   - **Reuse the same Meta creative across ad sets within one campaign** (no need to re-upload per ad set — Meta lets you attach one creative to N ads)
   - Per-asset upload happens ONCE; per-ad-set ad creation happens N times per asset
   - Return per-campaign success/fail summary (same shape as `/api/meta/launch-campaign` LaunchSummary)
3. **Rate-limit safety**:
   - Hard cap: refuse if `metaCampaignIds.length > 8` (single batch). Show error: "Bulk attach limited to 8 campaigns per run to avoid Meta rate limits. Split into smaller batches."
   - Run campaigns serially, not parallel (avoid #80004 ad-account bucket per `[[project_creator_meta_page_engagement_5_source_cap]]` style pacing)
   - Between campaigns: 1s sleep (defensive against #4 app-level bucket)
   - Use the launch-error classifier from PR #436 — translate #4/#17/#80004 to user-friendly 429s, no false token-reconnect prompts
4. **Activation status**: matches the new ACTIVE-by-default rule from PR #540/#541. Newly attached ads will be ACTIVE, start spending immediately.

### Database changes

None. Bulk-attach doesn't persist a new draft (it's an action, not a saved workflow). The new ads will surface in the existing creative reporting + dashboard via the standard active-creatives snapshot cron.

## Cursor prompt (paste tomorrow morning)

```
[Cursor, Sonnet]

GOAL: Add bulk-attach-new-creatives flow. User multi-selects N existing live Meta campaigns, uploads new creatives once, system creates new ads against ALL ad sets within each selected campaign.

CONTEXT: Drafted in docs/cursor-prompts/BULK_ATTACH_NEW_ASSETS_SCOPE_2026-06-04.md — read that first. Single source of truth for scope, UI changes, route shape, rate-limit pacing. Do not re-derive any of these from scratch.

START BY:
1. Reading the scope doc end to end.
2. Reading the existing single-campaign attach flow (whatever component "Open campaign creator" leads to) to confirm the wizard's existing primitives can be reused.
3. Reading lib/meta/client.ts createMetaAd / createMetaCreative / uploadVideoAsset / uploadImageAsset signatures — these MUST be reused, not duplicated.
4. Reading lib/meta/launch-error-classify.ts (PR #436) — the bulk-attach route must call this same classifier.

CHANGES (in order):
- Backend route POST /api/meta/bulk-attach-ads
- Backend test in app/api/meta/bulk-attach-ads/__tests__/ covering: single campaign single ad set, multi campaign multi ad set, rate-limit fall-through, 8-campaign hard cap
- UI: convert campaign picker to multi-select (preserve existing single-select callers if any)
- UI: new step for asset upload + caption + CTA (strip wizard down — no audiences / budget / scheduling)
- UI: review-and-launch step with Asset × Campaign matrix
- Activation status: ACTIVE per PR #540/#541 default

NON-NEGOTIABLES:
- 8-campaign hard cap on bulk-attach. Refuse with clear error, do NOT silently truncate.
- Serial execution across campaigns, 1s sleep between. No parallel campaign loops.
- Reuse one Meta creative per asset per CAMPAIGN — don't re-upload the same file for each ad set within a campaign.
- Use existing primitives. No duplicating createMetaAd / uploadVideoAsset logic.
- Per-campaign success/fail summary returned. Partial success is acceptable; UI must show per-campaign status.

BRANCH: cc/bulk-attach-new-creatives
1 PR with the route + tests + UI multi-select.
1 follow-up PR for the asset upload + matrix review steps if scope balloons.
```

## Memory cross-reference

Once shipped, save as `project_creator_bulk_attach_new_creatives.md` with:
- 8-campaign cap rationale (rate-limit floor before #4/#17/#80004)
- Reuse-creative-per-asset-per-campaign architecture
- Activation-by-default contract (per PRs #540/#541)

## Tonight (workaround)

If Matas needs to attach the new assets to specific campaigns RIGHT NOW (rate-limit window willing):

1. Open Meta Ads Manager → existing campaign with the new ads
2. Select the ad → click "Duplicate" → choose "Custom" → select target ad sets in OTHER campaigns
3. Meta replicates the ad. Takes ~30s per duplication. Limited to 1 source ad → N target ad sets.
4. Repeat per new asset.

Not great UX but unblocks tonight's work. Better than waiting for tomorrow's build for one urgent batch.
