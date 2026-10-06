# Audit: subcode=1885396 — BOOK_NOW rejected for OUTCOME_SALES in dynamic creative

**Date:** 2026-06-05  
**Branch:** `cursor/diagnose-1885396-dynamic-creative-cta-constraint`  
**Status:** Diagnosis complete. Proposed fix shapes at bottom.  
**Symptom:** `"The call-to-action type BOOK_NOW is not supported for the objective OUTCOME_SALES in dynamic creative ad set."`

---

## 1. Scope of the problem

Aberdeen launch (4thefans, WC26) succeeded past the IG identity bug (PR #570) but hit a new
blocker at the `/ads` creation step. Error is `code=100, error_subcode=1885396`.

Matas observed that Meta Ads Manager accepts BOOK_NOW for the same campaign. This created the
hypothesis that our API call triggers a stricter validation path than the UI does.

---

## 2. What the investigation confirmed

### 2.1 The error fires at `/ads`, not at `/adcreatives`

Validate-only probes against `/act_{adAccountId}/adcreatives` all **passed**, including the full
failing payload (AFS + `asset_customization_rules` + BOOK_NOW + OUTCOME_SALES):

```
P1: AFS + customization_rules + BOOK_NOW  → adcreatives validate_only → SUCCESS
P2: AFS (no rules)            + BOOK_NOW  → adcreatives validate_only → SUCCESS
P3: AFS + no optimization_type + BOOK_NOW → adcreatives validate_only → SUCCESS
P4: AFS + customization_rules + SHOP_NOW  → adcreatives validate_only → SUCCESS
P5: Standard link creative    + BOOK_NOW  → adcreatives validate_only → SUCCESS
```

The creative payload itself is valid. The constraint fires when Meta links a creative to the
OUTCOME_SALES ad set at `/ads` creation time.

### 2.2 The trigger is `asset_feed_spec` itself — not `asset_customization_rules`

Validate-only probes against `/act_{adAccountId}/ads` (using real creative IDs):

| Probe | Creative shape | CTA | `/ads` result |
|-------|---------------|-----|---------------|
| A1-A3 | AFS + customization_rules | BOOK_NOW | **FAIL 1885396** (all 3 ad sets) |
| B1 | Standard link creative (no AFS) | BOOK_NOW | **SUCCESS ✓** |
| B2 | AFS + customization_rules | SHOP_NOW | **SUCCESS ✓** |
| B3 | AFS, NO customization_rules | BOOK_NOW | **FAIL 1885396** |
| B4 | AFS + customization_rules | BOOK_NOW | **FAIL 1885396** |

**B3 is the decisive probe.** Removing `asset_customization_rules` from the AFS creative still
fails. The restriction fires on `asset_feed_spec` presence alone, not on any sub-field within it.

**B1 is the baseline.** Standard link creative with BOOK_NOW passes — this is what Ads Manager
uses when Matas tests the single-image UI flow. The UI path never produces `asset_feed_spec`.

### 2.3 The ad sets are NOT `is_dynamic_creative=true`

```json
{
  "name": "MOFU - Aberdeen 40km - 18-50",
  "is_dynamic_creative": false,
  "optimization_goal": "LANDING_PAGE_VIEWS"
}
```

All three Aberdeen ad sets have `is_dynamic_creative: false`. The "dynamic creative" label in the
error message is Meta's internal classification for the creative, not the ad set flag.

### 2.4 CTA compatibility matrix for AFS + OUTCOME_SALES at `/ads`

Tested with AFS + `asset_customization_rules` shape (our production path):

| CTA | `/ads` validate_only |
|-----|----------------------|
| `BOOK_NOW` | **FAIL** (subcode=1885396) |
| `SHOP_NOW` | SUCCESS ✓ |
| `LEARN_MORE` | SUCCESS ✓ |
| `GET_OFFER` | SUCCESS ✓ |
| `GET_QUOTE` | SUCCESS ✓ |

Of the three CTAs the wizard exposes (`sign_up`, `learn_more`, `book_now`):
- `sign_up` → untested but almost certainly fine (same family as LEARN_MORE)
- `learn_more` → SUCCESS ✓
- `book_now` → **FAIL in AFS path only**

### 2.5 Meta documentation cross-reference

Meta's [Asset Feed Spec docs](https://developers.facebook.com/docs/marketing-api/ad-creative/asset-feed-spec/)
distinguish two modes:
- **Asset Customization** — AFS with `asset_customization_rules` for per-placement routing
- **Dynamic Creative** — AFS without `customization_rules`, uses `AUTOMATIC_FORMAT`

Meta's own docs say "For Dynamic Creative, `asset_feed_spec` should not have customization rules."
Yet our B3 probe (AFS without rules) also fails with 1885396. This confirms Meta applies the
dynamic-creative CTA restriction to ANY creative that contains `asset_feed_spec`, regardless of
whether `asset_customization_rules` is present.

The [Dynamic Creative docs](https://developers.facebook.com/docs/marketing-api/ad-creative/asset-feed-spec/dynamic-creative/)
state the allowed objectives include OUTCOME_SALES but require `optimization_goal: OFFSITE_CONVERSIONS`.
Our ad sets use `LANDING_PAGE_VIEWS` — which is a secondary violation, though not the one surfacing
in this error.

---

## 3. Root cause

**Meta classifies any creative that contains `asset_feed_spec` as a "dynamic creative" for the
purpose of CTA validation at `/ads` creation time.** The restriction is applied server-side based
on the creative's content, independent of `is_dynamic_creative` on the ad set.

For the `OUTCOME_SALES` + `asset_feed_spec` combination, `BOOK_NOW` is not in Meta's allowed CTA
set. `SHOP_NOW`, `LEARN_MORE`, `GET_OFFER`, and `GET_QUOTE` all pass.

The Ads Manager UI works for Matas because it never uses `asset_feed_spec` for the single-image
test case — it generates a standard `link_data` creative which has no such restriction.

This is a Meta API contract constraint that was not surfaced by `adcreatives` validate_only.

---

## 4. Proposed fix shapes

### Path A — Skip multi-placement for `book_now` CTA (fall back to single-asset)

In `buildCreativePayload`, when `detectMultiPlacement` returns a plan **AND** the CTA is
`book_now`, bypass `buildMultiPlacementCreative` and fall back to the standard
`buildLinkCreative` / `buildVideoCreative` path using the feed (4:5) asset.

**Pros:**
- BOOK_NOW button text is preserved exactly
- No API surprise; standard creative path is battle-tested
- No change to the CTA enum or mapping code

**Cons:**
- The 9:16 vertical asset is uploaded but never rendered — Stories/Reels get the 4:5 asset
- Per-placement optimization is silently dropped without UI feedback
- Matas sees the 9:16 field in the wizard but it has no effect at launch

**Risk:** Low. Reverts to the pre-PR-#561 behaviour for BOOK_NOW + dual-aspect.

---

### Path B — Substitute `BOOK_NOW` → `LEARN_MORE` inside `buildMultiPlacementCreative`

In `buildMultiPlacementCreative` only, remap `BOOK_NOW` to `LEARN_MORE` before writing
`call_to_action_types` into the AFS spec. Emit a structured log noting the substitution.

```typescript
// AFS restriction: BOOK_NOW not accepted for OUTCOME_SALES + asset_feed_spec.
// LEARN_MORE is the safe universal fallback (PR #571 audit).
const afsCompatibleCta = cta === "BOOK_NOW" ? "LEARN_MORE" : cta;
spec.call_to_action_types = [afsCompatibleCta];
```

**Pros:**
- Per-placement asset routing works — 9:16 in Stories/Reels, 4:5 in Feed
- Single-line change; minimal blast radius
- Standard link creative path (used when single-aspect or when multi-placement skipped) still sends `BOOK_NOW` correctly

**Cons:**
- CTA button text changes from "Book Now" to "Learn More" for dual-aspect ads only — Matas would notice
- The substitution is invisible in the wizard; user has no awareness it happened
- Semantically: "Learn More" is weaker intent signal for event ticketing than "Book Now"

**Risk:** Medium. The functional change (button text) is user-visible.

---

### Path C — Different AFS construction to avoid dynamic-creative classification

**Not viable.** B3 proved `asset_feed_spec` without `asset_customization_rules` also fails with
1885396. There is no construction of `asset_feed_spec` that avoids Meta's dynamic-creative CTA
restriction. The trigger is the presence of `asset_feed_spec` in the creative payload, full stop.

---

### Path D — UX gate: disable `book_now` when dual-aspect mode is active

In the creative step UI (`components/steps/creatives.tsx`), when the active ad is in `dual` or
`dual_video` asset mode, filter `CTA_OPTIONS` to exclude `book_now`. Show a tooltip:

> "Book Now" is not supported for multi-placement ads. Use Learn More or switch to single-asset mode.

**Pros:**
- Honest to the user; no silent substitution
- Preserves intent for the fallback (single-asset) path where BOOK_NOW works
- Educates the user about the platform constraint

**Cons:**
- Adds UI complexity to `creatives.tsx`
- Existing drafts with `cta: "book_now"` + dual-aspect mode silently inherit the constraint
  until the user revisits the creative step
- `creatives.tsx` is a read-only file per `dashboard-boundaries.mdc` for this thread — needs a
  separate PR in a Cursor thread that owns `components/steps/`

**Risk:** Medium. UI change requires updating existing draft handling.

---

### Path E — Hybrid: Path B + structured log + future UI gate

Immediate: apply Path B substitution (BOOK_NOW → LEARN_MORE in AFS path) with a log.
Follow-up: implement Path D UI gate so users understand the constraint before launch.

This unblocks the immediate Aberdeen launch and creates a paper trail for the UX improvement.

---

## 5. Decision

Recommendation: **Path B for the immediate fix (PR #571), Path D as a follow-up**.

Rationale:
- Aberdeen ads must launch tonight. Path B is a one-line change with no risk of launch failure.
- "Learn More" is universally accepted; the button is still a clear purchase intent signal
  when paired with a strong ad body ("Tickets from £X — Book before they sell out").
- Path A silently degrades placement quality — the whole point of dual-aspect upload is 9:16
  in Stories/Reels. Dropping that silently is a worse outcome than "Learn More" button text.
- Path D (UI gate) is the right long-term UX but requires a separate PR in the wizard thread.

If Matas considers "Learn More" unacceptable for 4thefans brand, the alternative fallback CTA
to evaluate first is `GET_OFFER` — it passed validation and reads as "Get Offer" which is closer
to "Book Now" in intent. Decision to the product owner.

---

## 6. Probe ledger (all validate_only, v23.0, 2026-06-05)

All probes used `access_token` from the 4thefans user DB token, `adAccountId=act_10151014958791885`,
`pageId=202868440480679`, `instagramUserId=17841407313865620`.

Image hashes used: `c324ec4d7fa3cca096a028e8d52aa71b` (4:5 feed), `f93f1038359eadfa7ef7a0a975ccce68` (9:16 vertical).

All real creatives created for `/ads` probes were deleted after the test.

Ad sets confirmed `is_dynamic_creative: false` before probes.
