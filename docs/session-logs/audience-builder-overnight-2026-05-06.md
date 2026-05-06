# Audience Builder overnight — 2026-05-06 → 05-07

Rolling session log. Updated after each task.

---

## TASK 0 — Prerequisite: Merge PR #317

- **PR:** [#317](https://github.com/matas-offpixel/meta-campaign-builder/pull/317) `fix(audiences): ACTUALLY apply Meta payload corrections (post-#315 verification gate)`
- **Status:** ✅ Merged (squash, branch deleted)
- `grep -r "VIDEO_VIEWERS_VIEWED" lib/` → clean ✅

---

## TASK 1 — Sidebar nav on audience-builder routes

- **PR:** [#319](https://github.com/matas-offpixel/meta-campaign-builder/pull/319) — merged ✅
- **Branch:** `thread/audience-routes-under-dashboard`
- Moved `app/audience-builder/` and `app/audiences/` under `app/(dashboard)/`
  so they inherit the `DashboardLayout` (sidebar nav).
- Build: `/audience-builder`, `/audiences`, `/audiences/[clientId]`, `/audiences/[clientId]/new` all emit as `ƒ` ✅
- **Acceptance (needs manual smoke):**
  - [ ] Sidebar visible on `/audience-builder`
  - [ ] Sidebar visible on `/audiences/[clientId]`
  - [ ] Sidebar visible on `/audiences/[clientId]/new`

---

## TASK 2 — Campaign stats column (impressions fallback)

- **PR:** [#321](https://github.com/matas-offpixel/meta-campaign-builder/pull/321) — merged ✅
- **Branch:** `thread/audience-campaign-impressions-stat`
- `fetchAudienceCampaigns` now returns `impressions` from `last_year` insights.
- Campaign limit raised 50 → 200.
- Campaign rows show impressions (formatted "1.2M impr.") when spend is £0.
- Sorted by spend desc → impressions desc → name.
- **Acceptance (needs manual smoke):**
  - [ ] BOH campaigns show impressions count when spend is 0
  - [ ] Full 200-campaign list visible for clients with large catalogues

---

## TASK 3 — Select-all visible campaigns

- **PR:** [#322](https://github.com/matas-offpixel/meta-campaign-builder/pull/322) — merged ✅
- **Branch:** `thread/audience-campaign-select-all`
- "Select all N matching" button merges visible campaign IDs into selection.
- "Clear N selected" button resets to empty selection.
- Count line: `12 matching · 3 selected`.
- **Acceptance (needs manual smoke):**
  - [ ] Search "bohfest" → "Select all 12 matching" selects all 12
  - [ ] Narrowing search updates count correctly

---

## TASK 4 — Fix selectedCampaignIds [] bug + scoped fetch

- **PR:** [#323](https://github.com/matas-offpixel/meta-campaign-builder/pull/323) — merged ✅
- **Branch:** `thread/audience-video-scoped-fetch`
- Bug: `value.campaignIds?.length` is `0` (falsy) when user deselects last campaign, causing fallthrough to `[campaignId]`. Fixed by checking `!== undefined`.
- Added "N videos from M campaigns · K selected" count line above video grid.
- **Acceptance (needs manual smoke):**
  - [ ] Deselecting all campaigns collapses video grid
  - [ ] Video grid shows only videos from selected campaigns

---

## TASK 5 — Video thumbnail fallback

- **PR:** [#325](https://github.com/matas-offpixel/meta-campaign-builder/pull/325) — merged ✅
- **Branch:** `thread/audience-video-thumbnail-fallback`
- `fetchAudienceCampaignVideos` tries `/{id}/thumbnails?limit=1` when `picture` is null.
- Video tile shows bold filename (e.g. "0402(3).mp4") as primary label.
- Numeric ID in small monospace underneath.
- Placeholder box shows filename when both thumbnail sources return null.
- `videoTilePrimaryLabel` returns "Untitled video" instead of raw "Video".
- **Acceptance (needs manual smoke):**
  - [ ] Videos with null `picture` show thumbnail from `/thumbnails` endpoint
  - [ ] Filenames visible on tiles; IDs de-emphasised

---

## TASK 6 — BOH smoke test (manual, pending Vercel deploy of PRs 319+321+322+323+325)

**Not verified in this session (cannot hit Meta production from here).**

Gates — confirm each audience creates with `status='ready'` + non-null `meta_audience_id`:

| Subtype | Status |
|---------|--------|
| `website_pixel` (Back Of House Festival) | ⏳ pending |
| `video_views` (1-2 BOH campaigns, 95% threshold) | ⏳ pending |
| `page_engagement_fb` (Back Of House Festival FB page) | ⏳ pending |
| `page_engagement_ig` (backofhouse.festival IG) | ⏳ pending |

Update with:
`Verified live in production: ✅ website_pixel | ✅ video_views | ✅ page_engagement_fb | ✅ page_engagement_ig`
— or list failing subtype with exact Graph `error_subcode` / `status_error` text.

---

## Unexpected findings

- Local git was on stale named branches (PR #320 open for enhancement scanner). Multiple `git reset --hard` calls needed to recover correct HEAD.
- `creator/enhancement-*` branches have uncommitted changes from parallel work; not touched.

## Graph API calls estimate

- Tasks 1–5: 0 Meta API calls (all frontend/structure changes).
- Task 6 smoke will consume 4–8 Graph calls per audience create.
