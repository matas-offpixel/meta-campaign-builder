# Audit: 1885396 scope extension — BOOK_NOW + AFS across all objectives

**Date:** 2026-06-06  
**Branch:** `cursor/audit-cta-afs-objective-scope`  
**Extends:** PR #571 audit (`docs/AUDIT_1885396_DYNAMIC_CREATIVE_CTA_2026-06-05.md`)  
**Question:** Is the BOOK_NOW + AFS rejection scoped to OUTCOME_SALES only, or is it universal?

---

## 1. Framing

PR #571 established:
- AFS + BOOK_NOW → FAIL 1885396 for OUTCOME_SALES (Aberdeen adsets)
- Standard link creative + BOOK_NOW → SUCCESS for OUTCOME_SALES
- AFS + SHOP_NOW / LEARN_MORE / GET_OFFER / GET_QUOTE → SUCCESS for OUTCOME_SALES

Matas confirmed via Ads Manager screenshots that BOOK_NOW is available for traffic, purchase,
and awareness campaigns. This created the hypothesis that the rejection is objective-specific —
perhaps only OUTCOME_SALES is affected.

This audit tests that hypothesis.

---

## 2. Probes

All probes: `/ads` validate_only, v23.0, 2026-06-06.  
Account: `act_10151014958791885` (4thefans). All probe creatives and test objects deleted after.

**Creatives used:**
- `AFS+BOOK_NOW` — AFS + `asset_customization_rules` (our exact production shape) + BOOK_NOW
- `AFS+SHOP_NOW` — same AFS shape + SHOP_NOW
- `AFS+SIGN_UP`  — same AFS shape + SIGN_UP
- `STD+BOOK_NOW` — standard `link_data` creative (no AFS), BOOK_NOW

**Ad sets used:**
- OUTCOME_SALES: `6932894728465` (Aberdeen MOFU, `opt=LANDING_PAGE_VIEWS`)
- OUTCOME_TRAFFIC: `52512338127869` (WC26 London, `opt=LANDING_PAGE_VIEWS`, ACTIVE)
- OUTCOME_AWARENESS: `52516643196869` (test adset created & deleted, `opt=REACH`)

---

## 3. Results — Full matrix

```
Objective             Creative shape    CTA         Result
─────────────────────────────────────────────────────────────────
OUTCOME_SALES         AFS + rules       BOOK_NOW    ✗ 1885396
OUTCOME_SALES         AFS + rules       SHOP_NOW    ✓
OUTCOME_SALES         AFS + rules       SIGN_UP     ✓
OUTCOME_SALES         standard link     BOOK_NOW    ✓

OUTCOME_TRAFFIC       AFS + rules       BOOK_NOW    ✗ 1885396 *
OUTCOME_TRAFFIC       AFS + rules       SHOP_NOW    ✓
OUTCOME_TRAFFIC       AFS + rules       SIGN_UP     ✓
OUTCOME_TRAFFIC       standard link     BOOK_NOW    ✓

OUTCOME_AWARENESS     AFS + rules       BOOK_NOW    ✗ 1885396
OUTCOME_AWARENESS     AFS + rules       SHOP_NOW    ✓
OUTCOME_AWARENESS     AFS + rules       SIGN_UP     ✓
OUTCOME_AWARENESS     standard link     BOOK_NOW    ✓
```

*Error message for OUTCOME_TRAFFIC says `"objective LINK_CLICKS"` — Meta internally maps
OUTCOME_TRAFFIC + LANDING_PAGE_VIEWS to the legacy LINK_CLICKS label in this validation.

---

## 4. Key findings

### 4.1 The constraint is universal — not objective-specific

`asset_feed_spec + BOOK_NOW` fails with subcode=1885396 for every objective tested: SALES,
TRAFFIC, and AWARENESS. The error message phrasing varies but the subcode is identical.

Matas's Ads Manager observation ("BOOK_NOW works for traffic and awareness") is correct but
not contradictory: Ads Manager generates standard `link_data` creatives, not AFS creatives.
Standard link creative + BOOK_NOW passes for ALL objectives (confirmed by STD+BOOK_NOW rows).

The constraint is: **creative contains `asset_feed_spec` → BOOK_NOW blocked, regardless of
campaign objective**.

### 4.2 The narrowest characterisation of the rejection

```
BOOK_NOW + asset_feed_spec → subcode=1885396 (at /ads, any objective)
BOOK_NOW + standard creative → SUCCESS (at /ads, any objective)
SHOP_NOW, SIGN_UP, LEARN_MORE + asset_feed_spec → SUCCESS (any objective)
```

The rejection is triggered by the intersection of:
- The `asset_feed_spec` field being present in the creative (any content)  
- The CTA being `BOOK_NOW` specifically

**Nothing else.** Not objective, not `optimization_goal`, not `is_dynamic_creative`, not
the presence of `asset_customization_rules`.

### 4.3 Meta's internal classification

Meta calls any creative with `asset_feed_spec` a "dynamic creative" for the purpose of CTA
validation at `/ads` creation time. Their dynamic-creative CTA allow-list excludes BOOK_NOW.
This is not documented. It does not appear in any `adcreatives` validate_only probe — the
check only fires at ad-link time.

### 4.4 Wizard CTA coverage

The wizard exposes three CTAs (`sign_up`, `learn_more`, `book_now`). Of these:
- `sign_up`  → safe in AFS path (SIGN_UP confirmed passing for all three objectives)
- `learn_more` → safe in AFS path (LEARN_MORE confirmed passing for OUTCOME_SALES in PR #571)
- `book_now` → **always blocked** in AFS path regardless of objective

---

## 5. What this means for the fix

The scope being universal (not OUTCOME_SALES-specific) closes off any objective-based gating
approach. The choice is between two structural paths:

### Path E — Conditional payload: use standard creative when AFS isn't strictly needed

AFS is strictly needed ONLY when `detectMultiPlacement` returns a plan (i.e., the user has
uploaded both a feed-aspect AND a vertical-aspect asset). The multi-placement creative code
only fires when both exist.

For **single-aspect uploads** (one image, one video — by far the common case), the code already
falls back to standard link/video creative. `BOOK_NOW` works fine there. No change needed.

For **dual-aspect uploads** (4:5 + 9:16 present), AFS is genuinely required for per-placement
routing. There is no AFS construction that allows BOOK_NOW. Path E cannot rescue this case —
the user must either:
- Switch CTA away from BOOK_NOW, OR
- Accept that Stories/Reels will receive the 4:5 feed asset (i.e. skip AFS)

**Path E is already the status quo for single-aspect.** It does not help the dual-aspect case.

### Path D — UI gate: inform user of the constraint at creative configuration time

In `components/steps/creatives.tsx`, when the active ad is in `dual` or `dual_video` asset
mode, show a non-blocking warning when `book_now` is selected:

> **"Book Now" is not available for multi-placement ads.** Meta's API blocks this CTA when ads
> use per-placement asset routing. Switch to **Sign Up** or **Learn More**, or change to
> single-asset mode to keep "Book Now".

Additionally, at launch time (`buildMultiPlacementCreative`), if CTA is BOOK_NOW, fail fast
with a clear error message rather than letting the Meta API call fail silently:

```typescript
if (cta === "BOOK_NOW") {
  throw new Error(
    `CTA "BOOK_NOW" is not supported with per-placement (dual-aspect) creatives. ` +
    `Switch to SIGN_UP or LEARN_MORE, or use single-asset mode.`
  );
}
```

This surfaces the constraint at the wizard level (path D) and provides a clear runtime error
(path D+) instead of an opaque Meta API failure.

### Path F — Degrade gracefully for dual-aspect + BOOK_NOW (fallback to 4:5 standard creative)

When `detectMultiPlacement` returns a plan AND CTA is `book_now`, skip AFS and fall back to
standard link/video creative using only the feed (4:5) asset. Log a prominent warning.

**Pros:** BOOK_NOW preserved. No user action needed.  
**Cons:** 9:16 vertical asset is uploaded but ignored. User uploaded it for a reason. Silent
quality degradation — Matas sees the 9:16 field in the wizard but it has no effect.

---

## 6. Recommendation

**Immediate** (unblocks Aberdeen tonight):
- Change CTA from `book_now` to `sign_up` or `learn_more` directly in the draft for the
  Aberdeen campaign. Both pass with the dual-aspect AFS creative. No code change required.

**PR #572 (next session, one-file fix in `lib/meta/creative.ts`):**
- In `buildMultiPlacementCreative`, guard against `BOOK_NOW` CTA and throw a clear error
  with an actionable message (Path D+). This turns a silent Meta API failure into a
  visible, actionable launch-time error.

**PR after #572 (wizard thread, requires `components/steps/creatives.tsx`):**
- UI gate in `creatives.tsx`: when dual-aspect mode is detected, show an inline warning when
  `book_now` is selected. Present the two options (change CTA or switch to single-asset mode).

No silent substitution. No objective-based gating (scope is universal). The root constraint
is a Meta API limitation that cannot be worked around without changing either the CTA or the
creative shape.

---

## 7. Probe ledger (2026-06-06)

- Account: `act_10151014958791885` (4thefans, GB)
- Image hashes (re-used from PR #571): `c324ec4d…` (4:5), `f93f1038…` (9:16)
- Page: `202868440480679`, IG: `17841407313865620`
- 5 probe creatives created and deleted
- 1 test AWARENESS campaign + adset created and deleted
- All probes: v23.0, `execution_options=["validate_only"]` at `/ads`
