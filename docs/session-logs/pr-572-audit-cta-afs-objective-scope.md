# Session log — audit CTA AFS objective scope (extends PR #571)

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/audit-cta-afs-objective-scope`

## Summary

Extended the PR #571 BOOK_NOW + asset_feed_spec audit to cover all campaign objectives used
by 4thefans. Confirmed the restriction is universal — AFS + BOOK_NOW fails with subcode=1885396
for OUTCOME_SALES, OUTCOME_TRAFFIC, and OUTCOME_AWARENESS alike. Standard link creative +
BOOK_NOW passes for all three. The constraint is in the creative shape (AFS presence), not the
campaign objective.

## Scope / files

- `docs/AUDIT_1885396_CTA_SCOPE_EXTENDED_2026-06-06.md` — extended audit memo with full matrix

## Validation

- No code changed.

## Key findings

1. AFS + BOOK_NOW fails for SALES, TRAFFIC, and AWARENESS — subcode=1885396 each time.
2. Standard creative + BOOK_NOW passes for all three objectives.
3. AFS + SHOP_NOW, SIGN_UP, LEARN_MORE pass for all three objectives.
4. The fix is not objective-scoped — any objective-gating approach in the UI would be wrong.
5. Immediate unblock: change draft CTA from book_now to sign_up/learn_more in the wizard.
6. Next PR: throw a clear error in buildMultiPlacementCreative when CTA=BOOK_NOW.
7. Later PR: UI gate in creatives.tsx showing constraint when dual-aspect + BOOK_NOW selected.
