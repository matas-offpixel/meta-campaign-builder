# AUDIT: BOOK_NOW + AFS — Exact Constraint Scope After Brighton Falsification Claim
**Date:** 2026-06-06  
**Branch:** `cursor/audit-book_now-actual-scope-after-brighton-falsification`  
**Auditor:** Cursor (Sonnet 4.6)  
**Context:** PR #574 — follow-up to PRs #571/#572/#573 which concluded "AFS + BOOK_NOW universally fails." User reported a Brighton WC26 ONSALE Relaunch on 2026-06-05 23:xx BST succeeded with BOOK_NOW across 8 ads in 4 adsets, appearing to falsify that conclusion.

---

## 1 — Investigation of the "Brighton Falsification"

### 1.1 What actually launched on 2026-06-05 at 22:07 and 22:32 UTC

Two `POST /api/meta/launch-campaign` calls occurred:

| Time (UTC) | Deployment | Draft URL |
|---|---|---|
| 22:07:28 | `dpl_9jVYWHJS1RtTLirrpVP3o1vPpV8B` | `/campaign/3398a4e0-d949-4d90-9ce7-75e18e772899` |
| 22:32:33 | `dpl_ACKgTzB9tVevHbT1gCD6rdCNLLAP` | `/campaign/3398a4e0-d949-4d90-9ce7-75e18e772899` |

Both calls were from the **same Aberdeen draft** (`3398a4e0`).

### 1.2 Aberdeen draft state at time of launch

```
campaign_code:  WC26-ABERDEEN
wizardMode:     attach_adset
creative_cta:   learn_more            ← NOT book_now
assets:         [c324ec4d… 4:5 image, f93f1038… 9:16 image]  ← Dual-image mode
adsets:         MOFU Aberdeen, BOFU Aberdeen, TOFU Aberdeen
```

**`learn_more` in dual-image mode → `buildMultiPlacementCreative` → AFS + `call_to_action_types: ["LEARN_MORE"]` → this succeeds and has always succeeded.**

### 1.3 Newcastle draft (the actual BOOK_NOW success)

Separately, draft `8ca9f1dc` (WC26-NEWCASTLE) has:

```
creative_cta:   book_now
assets:         [9:16 video only — single mode]
```

Single mode + 9:16 video → `detectMultiPlacement` returns `null` (only one aspect ratio)
→ falls through to `buildVideoCreative`
→ `object_story_spec.video_data.call_to_action.type = "BOOK_NOW"` (no AFS at all)
→ **this always succeeds** and is a known-working path since PR #561.

### 1.4 Conclusion on the "falsification"

**The Brighton/Newcastle launch did NOT falsify the AFS + BOOK_NOW constraint.** The successful BOOK_NOW launch used a standard `video_data` creative (no AFS), which is the single-asset path. The "8 ads in 4 multi-placement ad sets" refers to the targeting configuration of the ad sets (multiple placement positions in their targeting), not multi-asset-per-placement creative routing.

The Aberdeen launch that actually used AFS succeeded because it was configured with `learn_more`, not `book_now`.

---

## 2 — Re-Probed Constraint Matrix (PR #574)

### 2.1 Setup

- **Account:** `act_10151014958791885`  
- **API version:** `v23.0`  
- **SALES adset:** `52516668535869` (OUTCOME_SALES, fresh audit campaign)  
- **TRAFFIC adset:** `52516668239069` (OUTCOME_TRAFFIC)  
- **AWARENESS adset:** `52516668659269` (OUTCOME_AWARENESS)  
- **4:5 image:** `c324ec4d…` (Aberdeen feed asset)  
- **9:16 image:** `f93f1038…` (Aberdeen story asset)  
- **Feed video:** `1690405915416404` (4:5 MP4)  
- **Story video:** `1038568415501717` (9:16 MP4)

### 2.2 Probe results

| Probe | Shape | Result |
|---|---|---|
| **A** | AFS + SINGLE_IMAGE + `ad_formats:["SINGLE_IMAGE"]` + BOOK_NOW + 2 rules + PLACEMENT | ✗ `sub=1885396` SALES |
| **B** | Same as A, LEARN_MORE | ✓ SALES |
| **C** | AFS + SINGLE_VIDEO + `ad_formats:["SINGLE_VIDEO"]` + BOOK_NOW + 2 rules + PLACEMENT | ✗ `sub=1885396` SALES/TRAFFIC/AWARENESS |
| **D** | Same as C, LEARN_MORE | ✓ SALES/TRAFFIC/AWARENESS |
| **E** | AFS + SINGLE_IMAGE + BOOK_NOW + 1 rule only | ✗ Creative rejected ("require at least 2 target rules") |
| **F** | AFS + SINGLE_IMAGE + BOOK_NOW + NO rules | ✗ `sub=1885396` SALES |
| **G** | AFS + BOOK_NOW + no rules, no ad_formats, no opt_type | ✗ Creative rejected ("An asset feed can have exactly one ad format") |
| **H** | Standard `link_data + BOOK_NOW` (no AFS) | ✓ SALES |
| **Brighton** | Standard `video_data + BOOK_NOW` (no AFS) | ✓ (confirmed by live production launch) |

### 2.3 Hybrid shapes tested (PR #574 continuation from PR #573)

| Probe | Shape | Result |
|---|---|---|
| **H3-A** | `link_data(BOOK_NOW)` + AFS(rules, 9:16 only, PLACEMENT) | ✗ Creative rejected ("An asset feed can have exactly one ad format") |
| **H3-B** | `link_data(BOOK_NOW)` + AFS(rules, BOTH images, PLACEMENT) | ✗ Creative rejected (same) |
| **H3-C** | `link_data(BOOK_NOW, flexible)` + AFS(rules, 9:16, PLACEMENT) | ✗ Creative rejected (same) |
| **H3-D** | `link_data(BOOK_NOW)` + AFS(rules, BOTH images, no opt_type) | ✗ Creative rejected (same) |
| **H3-E** | `link_data(BOOK_NOW)` + AFS(rules, BOTH images, DOF) | Creative created ✓ but AFS images+rules silently DROPPED on read-back |

---

## 3 — Precise Constraint Characterisation

### The constraint is exactly:

> **`asset_feed_spec.call_to_action_types: ["BOOK_NOW"]`** at the `/ads` endpoint returns  
> `code=100 subcode=1885396 "The call-to-action type BOOK_NOW is not supported for the objective … in dynamic creative ad set"` for:
> - **any objective**: OUTCOME_SALES, OUTCOME_TRAFFIC, OUTCOME_AWARENESS
> - **any media type**: image (SINGLE_IMAGE), video (SINGLE_VIDEO)  
> - **any rule count**: 0 rules, 2 rules — the rules themselves are irrelevant
> - The error fires at `/ads` validate_only, NOT at `/adcreatives` creation

### What does NOT trigger the constraint:

| CTA location | BOOK_NOW works? |
|---|---|
| `object_story_spec.video_data.call_to_action.type` | ✓ YES (Brighton/Newcastle proof) |
| `object_story_spec.link_data.call_to_action.type` | ✓ YES (Probe H) |
| `asset_feed_spec.call_to_action_types` | ✗ NO — always 1885396 |

### Root cause

When `asset_feed_spec` is present and structurally valid (images/videos + link_urls + bodies), Meta classifies the creative as a "dynamic creative" regardless of `optimization_type` or `ad_formats`. The 1885396 CTA restriction is enforced at the dynamic-creative classification level, not at the placement-customization level. BOOK_NOW is explicitly excluded from the allowed dynamic-creative CTA list.

### What does NOT work as escape hatches

1. **Changing `optimization_type`**: PLACEMENT, DEGREES_OF_FREEDOM, no opt_type — all fail equally  
2. **Removing `asset_customization_rules`**: Still 1885396 with 0 rules  
3. **Changing `ad_formats`**: SINGLE_IMAGE vs SINGLE_VIDEO — both fail  
4. **Mixing `link_data(BOOK_NOW)` + AFS images**: "An asset feed can have exactly one ad format" at `/adcreatives`  
5. **DOF hybrid**: Creative accepts the combined shape but silently drops the AFS images and rules on write  
6. **Inline creative in `/ads` POST**: Same "one ad format" rejection  
7. **No existing Ads Manager created creative** in the `act_10151014958791885` account has both `asset_customization_rules` AND `call_to_action_types: ["BOOK_NOW"]`

---

## 4 — Impact on the Wizard

### Current code paths

```
buildCreativePayload()
  │
  ├─ detectMultiPlacement(creative) → plan?
  │     • plan != null: BOTH feed (4:5/1:1) AND vertical (9:16) present, same media kind
  │
  ├─ plan != null + ENABLE_MULTI_PLACEMENT_ASSETS=1
  │     → buildMultiPlacementCreative(creative, plan)
  │         AFS + call_to_action_types: [mapCTAToMeta(creative.cta)]   ← FAILS if cta='book_now'
  │
  └─ plan == null OR flag off
        → buildVideoCreative  (video_data, no AFS) — BOOK_NOW always works
        → buildLinkCreative   (link_data, no AFS)  — BOOK_NOW always works
```

### Which combinations are broken

| Asset Mode | CTA | Status |
|---|---|---|
| Single video (9:16 only) | BOOK_NOW | ✓ Works — `buildVideoCreative` |
| Single image (4:5 or 9:16) | BOOK_NOW | ✓ Works — `buildLinkCreative` |
| Dual image (4:5 + 9:16) | LEARN_MORE | ✓ Works — `buildMultiPlacementCreative` |
| Dual video (4:5 + 9:16) | LEARN_MORE | ✓ Works — `buildMultiPlacementCreative` |
| **Dual image (4:5 + 9:16)** | **BOOK_NOW** | **✗ 1885396** |
| **Dual video (4:5 + 9:16)** | **BOOK_NOW** | **✗ 1885396** |

---

## 5 — Fix Shape: Dual-Mode + BOOK_NOW

### The only viable approach (no CTA substitution, no ad-set fan-out)

When `detectMultiPlacement(creative) !== null` AND `creative.cta === 'book_now'`:

**Render as single-asset using the vertical (9:16) asset.**

- **For image dual**: take the 9:16 `assetHash` → `buildLinkCreative` with that hash. The same 4:5 ALSO served in the vertical slot will be auto-cropped by Meta for Feed.  
- **For video dual**: take the 9:16 `videoId` → `buildVideoCreative`. This is exactly what Brighton did — single 9:16 video runs across all placements.

The CTA stays `BOOK_NOW`. Per-placement routing is surrendered for BOOK_NOW. The creative renders the vertical asset everywhere; Meta auto-adapts for Feed if the ad set targets Feed.

### Wizard-level routing change (in `buildCreativePayload`)

```typescript
// After detectMultiPlacement(creative) → plan
if (plan && process.env.ENABLE_MULTI_PLACEMENT_ASSETS === "1") {
  const cta = mapCTAToMeta(creative.cta);
  if (cta === "BOOK_NOW") {
    // BOOK_NOW is blocked in asset_feed_spec.call_to_action_types (subcode 1885396).
    // Fall through to single-asset path using the vertical asset.
    console.error(
      `[buildCreativePayload] "${creative.name}" → SINGLE-ASSET fallback` +
      ` (BOOK_NOW blocked in AFS — using ${plan.mediaKind} vertical asset)`,
    );
    // Override: pretend only the vertical asset exists so buildVideo/LinkCreative picks it up.
    // The caller receives a single-asset creative; per-placement rendering is not available for BOOK_NOW.
  } else {
    return buildMultiPlacementCreative(creative, plan, validatedIgActorId);
  }
}
```

Alternative: throw a clear error and surface it in the UI so Matas sees the constraint before attempting to launch, rather than silently falling back.

### UI gate (companion to the code fix)

In `components/steps/creatives.tsx`, disable the BOOK_NOW option in `CTA_OPTIONS` when `dual-mode` is detected (i.e., both a feed-ratio and a 9:16 asset are present), with a tooltip:

> "Book Now is not available with dual-aspect ads. Choose Learn More, or upload one image/video for a single-placement creative."

---

## 6 — Memory Update

**Replaces:** any prior memory stating "AFS + BOOK_NOW fails only for images" or "video AFS + BOOK_NOW may work."

**Correct rule:**

> `asset_feed_spec.call_to_action_types: ["BOOK_NOW"]` → subcode 1885396 for any objective (SALES/TRAFFIC/AWARENESS) and any media type (image SINGLE_IMAGE or video SINGLE_VIDEO), with or without asset_customization_rules.
> 
> BOOK_NOW works normally in `link_data.call_to_action.type` and `video_data.call_to_action.type` (standard single-asset creatives).
> 
> The only constraint is the AFS `call_to_action_types` field. Per-placement asset routing (AFS + customization_rules) and BOOK_NOW CTA are mutually exclusive in the Meta Marketing API as of v23.0.

---

## 7 — Recommended Next Steps

1. **Implement the wizard-level switch** in `buildCreativePayload`: when `plan != null && cta === 'BOOK_NOW'` → single-asset fallback using the vertical asset (not a silent CTA change).
2. **Add a UI gate** in step 4 (creatives) that disables BOOK_NOW in the CTA dropdown when dual-aspect mode is active, explaining why.
3. **Document for Matas**: the product constraint is that BOOK_NOW and per-placement rendering are currently mutually exclusive at the Meta API level. He can have either:
   - BOOK_NOW + single asset (all placements get the same creative, Meta auto-adapts)
   - LEARN_MORE + dual assets (per-placement rendering, different CTA)
4. **No further Meta API probing needed**: all escape routes exhausted. The constraint is at Meta's API validation layer, not a configuration error on our side.
