# Session log — diagnose 1885396 dynamic creative CTA constraint

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/diagnose-1885396-dynamic-creative-cta-constraint`

## Summary

Audit-only investigation into `subcode=1885396 "The call-to-action type BOOK_NOW is not supported
for the objective OUTCOME_SALES in dynamic creative ad set."` which surfaced after PR #570 fixed
the IG identity bugs and Aberdeen ads could finally reach the `/ads` creation step.

## Scope / files

- `docs/AUDIT_1885396_DYNAMIC_CREATIVE_CTA_2026-06-05.md` — full audit memo with all probe results

## Validation

- No code changed.

## Key findings

1. **Error fires at `/ads`, not `/adcreatives`.** Every `adcreatives` validate_only probe passed.
   The constraint is applied by Meta when linking a creative to an OUTCOME_SALES ad set.

2. **Trigger is `asset_feed_spec` presence, not `asset_customization_rules`.** Removing
   `asset_customization_rules` from the AFS creative still produces 1885396 (B3 probe).

3. **CTA matrix (AFS + OUTCOME_SALES, `/ads` validate_only):**
   - BOOK_NOW → FAIL
   - SHOP_NOW, LEARN_MORE, GET_OFFER, GET_QUOTE → SUCCESS

4. **Standard link creative + BOOK_NOW passes** — this is the path Ads Manager uses; hence Matas
   could create BOOK_NOW ads in the UI without seeing the error.

5. **Ad sets are `is_dynamic_creative: false`** — the classification is applied based on the
   creative's `asset_feed_spec` content, not the ad set flag.

## Recommended fix

**Path B (immediate):** Substitute `BOOK_NOW → LEARN_MORE` inside `buildMultiPlacementCreative`
only, with a structured log. Standard link creative (single-asset path) continues to send BOOK_NOW.

**Path D (follow-up):** UI gate in `creatives.tsx` — disable BOOK_NOW in the CTA dropdown when
dual-aspect asset mode is active, with an explanatory tooltip.
