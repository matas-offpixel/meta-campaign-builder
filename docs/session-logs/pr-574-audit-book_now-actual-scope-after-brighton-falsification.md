# Session log — audit-book_now-actual-scope-after-brighton-falsification

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/audit-book_now-actual-scope-after-brighton-falsification`

## Summary

User reported a "Brighton WC26 ONSALE Relaunch" that succeeded on 2026-06-05 23:xx BST with BOOK_NOW CTA across 8 ads in 4 adsets, apparently contradicting the PR #572/#573 conclusion that "AFS + BOOK_NOW universally fails." This audit investigated the live prod logs, the actual campaign draft state, and reprobed the Meta API constraint with additional probe variants (video dual-mode, single image with no rules, standard link_data/video_data control).

**Finding: the "falsification" was not a falsification.** The successful Brighton/Newcastle launch used a single 9:16 video through `buildVideoCreative` → standard `video_data.call_to_action.type = "BOOK_NOW"` (no AFS at all). The Aberdeen launch at the same time used `learn_more` (not `book_now`) in dual-image mode. BOOK_NOW in standard single-asset creatives has always worked.

**Precise constraint (updated):** `asset_feed_spec.call_to_action_types: ["BOOK_NOW"]` → subcode 1885396 for any objective (SALES/TRAFFIC/AWARENESS) and any media type (image SINGLE_IMAGE or video SINGLE_VIDEO). Standard `link_data` and `video_data` CTAs are unaffected.

## Scope / files

- `docs/AUDIT_BOOKNOW_AFS_CONSTRAINT_EXACT_SCOPE_2026-06-06.md` — full audit findings

## Key probes run

- **Probe C**: AFS + SINGLE_VIDEO + BOOK_NOW + 2 rules + PLACEMENT → ✗ 1885396 for SALES/TRAFFIC/AWARENESS (first video-AFS probe)
- **Probe F**: AFS + BOOK_NOW + NO rules → ✗ 1885396 (rules not the trigger)
- **Probe H**: standard link_data + BOOK_NOW (no AFS) → ✓ SUCCESS (control confirmed)
- **Probe D**: AFS + SINGLE_VIDEO + LEARN_MORE → ✓ for all objectives (control confirmed)

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `npm test`

## Notes

- No code changes in this PR — audit-only, same as PR #571/#572/#573.
- Recommended next PR: implement wizard-level `BOOK_NOW + dual-mode` → single-asset fallback in `buildCreativePayload`, plus UI gate in creatives step.
- The constraint is at Meta's API validation layer (`call_to_action_types` in AFS triggers "dynamic creative" classification, which excludes BOOK_NOW). No escape route found after exhausting all hybrid shapes.
