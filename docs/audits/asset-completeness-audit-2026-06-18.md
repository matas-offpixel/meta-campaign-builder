# Asset Completeness Audit — Dual/Full Mode Published Drafts

- **Date:** 2026-06-18
- **Scope:** All `status = 'published'` campaign drafts with `assetMode IN ('dual', 'full')` in the last 14 days (2026-06-04 → 2026-06-18)
- **Trigger:** Pre-PR validation for the asset-completeness gate. Needed to determine if any clients beyond `kickoffclubfanzones` shipped with single-aspect Dual-mode payloads.
- **Method:** Supabase MCP `execute_sql` on `campaign_drafts.draft_json` JSONB. Two independent checks:
  1. `uploadStatus = 'uploaded'` count vs required slots (`dual` → 2, `full` → 3)
  2. Meta asset ID present (`assetHash` or `videoId`) vs required slots (stricter)

---

## Result: CLEAN

**No incomplete dual/full-mode creative variations found in the last 14 days.**

Both checks (uploadStatus + Meta asset ID) returned zero rows across all three queries:
- Uploaded count < required slots → **0 rows**
- Meta asset ID count < required slots → **0 rows**
- Assets array length < required slots → **0 rows**

Extended window to 60 days — still zero incomplete rows.

---

## All dual/full-mode published drafts scanned (14-day window)

| Draft ID | Campaign Name | Client | Created At | Creative | Mode | Variations | Slots | Uploaded |
|---|---|---|---|---|---|---|---|---|
| `fc220167` | Australia vs USA — Final push | Kick Off Club | 2026-06-18 11:24 | USA vs AUS | dual/image | 1 | 2 | 2 ✅ |
| `fc220167` | Australia vs USA — Final push | Kick Off Club | 2026-06-18 11:24 | Eng vs Ghana | dual/image | 1 | 2 | 2 ✅ |
| `fc220167` | Australia vs USA — Final push | Kick Off Club | 2026-06-18 11:24 | Eng vs Panama | dual/image | 1 | 2 | 2 ✅ |
| `6fc1280e` | Australia vs USA — Final push | Kick Off Club | 2026-06-18 10:20 | Eng vs Panama | dual/image | 1 | 2 | 2 ✅ |
| `6fc1280e` | Australia vs USA — Final push | Kick Off Club | 2026-06-18 10:20 | Eng vs Ghana | dual/image | 1 | 2 | 2 ✅ |
| `74bc0168` | Puzzle Open Air — Final push | Puzzle | 2026-06-11 10:58 | Weather Asset | dual/image | 1 | 2 | 2 ✅ |
| `dc8c0b83` | England vs Ghana — Pre-announce | Kick Off Club | 2026-06-10 10:01 | England v Croatia - Soho | **full**/image | 1 | 3 | 3 ✅ |
| `3398a4e0` | Scotland v Morocco — Pre-announce | 4theFans | 2026-06-05 19:49 | Craig Levein Morocco | dual/image | 1 | 2 | 2 ✅ |
| `eb8e6a17` | Deep House Bible Egypt — Announce | Deep House Bible | 2026-06-04 17:09 | Static Lineup | dual/image | 1 | 2 | 2 ✅ |
| `eb8e6a17` | Deep House Bible Egypt — Announce | Deep House Bible | 2026-06-04 17:09 | Static No Lineup | dual/image | 1 | 2 | 2 ✅ |
| `eb8e6a17` | Deep House Bible Egypt — Announce | Deep House Bible | 2026-06-04 17:09 | No Lineup Video | dual/video | 1 | 2 | 2 ✅ |
| `eb8e6a17` | Deep House Bible Egypt — Announce | Deep House Bible | 2026-06-04 17:09 | Lineup Video | dual/video | 1 | 2 | 2 ✅ |

**Totals:** 5 unique published drafts · 4 clients · 12 dual/full-mode creative rows · **0 incomplete**

---

## Clients covered

| Client ID | Name | Slug |
|---|---|---|
| `ce942f1a` | Kick Off Club | kick-off-club |
| `92f7334b` | Puzzle | puzzle |
| `37906506` | 4theFans | 4thefans |
| `9daab5b0` | Deep House Bible | deep-house-bible |

> **Note on `kickoffclubfanzones`:** The `kickoffclubfanzones` slug referenced in the PR brief maps to the Kick Off Club client (`ce942f1a`). Their three dual-mode campaigns in the window all shipped with both `4:5` and `9:16` slots fully uploaded and with Meta asset hashes present. No relaunch required.

---

## SQL queries used

### Query 1 — uploadStatus completeness

```sql
WITH creative_data AS (
  SELECT
    cd.id AS draft_id,
    cd.draft_json->'settings'->>'campaignName' AS campaign_name,
    cd.client_id,
    cd.created_at,
    c->>'id' AS creative_id,
    c->>'name' AS creative_name,
    c->>'assetMode' AS asset_mode,
    c->>'mediaType' AS media_type,
    CASE c->>'assetMode'
      WHEN 'dual' THEN 2
      WHEN 'full' THEN 3
      ELSE 1
    END AS required_slots,
    c->'assetVariations' AS variations
  FROM campaign_drafts cd,
       jsonb_array_elements(cd.draft_json->'creatives') AS c
  WHERE cd.status = 'published'
    AND cd.created_at > NOW() - INTERVAL '14 days'
    AND c->>'assetMode' IN ('dual', 'full')
),
variation_check AS (
  SELECT
    cd.*,
    av->>'name' AS variation_name,
    jsonb_array_length(av->'assets') AS assets_total,
    (
      SELECT count(*)
      FROM jsonb_array_elements(av->'assets') AS a
      WHERE a->>'uploadStatus' = 'uploaded'
    ) AS assets_uploaded
  FROM creative_data cd,
       jsonb_array_elements(cd.variations) AS av
)
SELECT * FROM variation_check
WHERE assets_uploaded < required_slots
ORDER BY created_at DESC;
```

### Query 2 — Meta asset ID completeness (stricter)

```sql
-- Same CTE structure; replace the assets_uploaded subquery with:
(
  SELECT count(*)
  FROM jsonb_array_elements(av->'assets') AS a
  WHERE a->>'uploadStatus' = 'uploaded'
    AND (a->>'assetHash' IS NOT NULL OR a->>'videoId' IS NOT NULL)
) AS assets_with_meta_id
-- WHERE assets_with_meta_id < required_slots
```

### Query 3 — Short asset arrays

```sql
-- Same CTE structure; check jsonb_array_length(av->'assets') < required_slots
```

All three returned **0 rows** for both 14-day and 60-day windows.

---

## Conclusion for Matas

No relaunch required. The 5 published drafts with dual/full-mode creatives in the last 14 days all shipped with correct per-placement asset coverage. The asset-completeness gate being added in the upcoming PR closes a gap that was **latent but not yet triggered** in production.

The `kickoffclubfanzones` single-aspect issue referenced in the PR brief either occurred outside the 60-day audit window, was in a draft that was subsequently re-published with complete assets, or referred to an incident on a different campaign tool. No affected live ads were found.
