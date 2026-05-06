# Audience Builder overnight — 2026-05-06 → 05-07

Rolling session log. Updated after each task.

---

## TASK 0 — Prerequisite: Merge PR #317

- **PR:** #317 `fix(audiences): ACTUALLY apply Meta payload corrections (post-#315 verification gate)`
- **Status:** ✅ Merged (squash, branch deleted)
- `grep -r "VIDEO_VIEWERS_VIEWED" lib/` → clean

---

## TASK 1 — Sidebar nav on audience-builder routes

- **PR:** pending
- **Branch:** `thread/audience-routes-under-dashboard`
- Moved `app/audience-builder/` and `app/audiences/` under `app/(dashboard)/`
  so they inherit the `DashboardLayout` (sidebar nav).
- **Acceptance:**
  - [ ] Sidebar visible on `/audience-builder`
  - [ ] Sidebar visible on `/audiences/[clientId]`
  - [ ] Sidebar visible on `/audiences/[clientId]/new`
  - [ ] All nav links work from those pages

---

## TASK 2 — Campaign stats column (impressions fallback)

- **PR:** pending
- **Branch:** `thread/audience-campaign-impressions-stat`
- `fetchAudienceCampaigns` now returns `impressions` from `last_year` insights.
- Campaign rows show impressions (formatted "1.2M") when spend = £0.
- **Acceptance:**
  - [ ] BOH campaigns show impressions count when spend is 0
  - [ ] Sorted by max(spend, impressions proxy)

---

## TASK 3 — Select-all visible campaigns

- **PR:** pending
- **Branch:** `thread/audience-campaign-select-all`
- "Select all N matching" / "Clear N selected" buttons above campaign list.
- Count updates as search query changes.
- **Acceptance:**
  - [ ] "Select all 12 matching" selects all visible when clicked
  - [ ] Narrowing search updates count correctly

---

## TASK 4 — Fix selectedCampaignIds [] bug + scoped fetch

- **PR:** pending
- **Branch:** `thread/audience-video-scoped-fetch`
- Fixed `selectedCampaignIds` falling through to `campaignId` when `campaignIds = []`.
- Added "Showing N videos from M campaign(s)" count to grid header.
- **Acceptance:**
  - [ ] Deselecting all campaigns collapses video grid
  - [ ] Video grid only shows videos from selected campaigns

---

## TASK 5 — Video thumbnail fallback

- **PR:** pending
- **Branch:** `thread/audience-video-thumbnail-fallback`
- `fetchAudienceCampaignVideos` tries `/{id}/thumbnails?limit=1` when `picture` is null.
- Video tile shows filename (`video.title`) prominently; ID de-emphasised.
- **Acceptance:**
  - [ ] Videos with null `picture` show thumbnail from `/thumbnails` endpoint
  - [ ] If both null, shows filename + small ID (not "No thumbnail")

---

## TASK 6 — BOH smoke test (manual, after deploy)

- Pending Vercel deploy of tasks 1-5.
- Gates: website_pixel | video_views | page_engagement_fb | page_engagement_ig → all `status=ready`

---

## Unexpected findings

- _None yet._

## Graph API calls estimate

- _Not tracked automatically; check Vercel function logs._
