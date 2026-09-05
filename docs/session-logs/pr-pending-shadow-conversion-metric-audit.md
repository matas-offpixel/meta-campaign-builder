# Session log

## PR

- **Number:** pending
- **URL:**
- **Branch:** `cursor/shadow-conversion-metric-audit`

## Summary

Read-only last-7d Meta insights audit for the conversion campaigns that report "no cpr/cpa data". Token could read insights. Resolver mapping is not the gap — change nothing in `ACTION_TYPE_CANDIDATES`. Script: `scripts/audit-conversion-action-types.mjs`.

## Verdict

| Campaign (stored Meta id) | last_7d | Resolver |
|---|---|---|
| Woraklis `120250261231790708` | 177 complete_registration on 11/12 ad sets; Wide - 24-45 empty | already matches `complete_registration` in cost + pixel type in actions |
| DOD/FOLMAOUR `120251576269510755` | 19 ad sets, all `CAMPAIGN_PAUSED`, empty insights | n/a — truly zero in window |
| APPETITE `52512868723907` | engagement/video/1 LPV; **zero** purchase types | n/a — stored id is Camelphat Awareness, not APPETITE |
| DJ EZ Signup `120251362539090755` | 0 ad sets; campaign `ARCHIVED` | n/a |
| DJ EZ Signup `120251365378580755` | 16 ad sets, all PAUSED / CAMPAIGN_PAUSED, empty insights | n/a — truly zero in window |

No action types were added. Provenance note was not added because the resolver was not extended.

## Validation

- [x] `npm test` (5100 pass, 3 skipped)
- [x] `npm run build`

## Notes

Supporting (not used to change code): live `[IRW0005] APPETITE - ON SALE` is `52517716665907` and has `purchase` in `cost_per_action_type` (resolver already lists it). Live `[NX26-DOD] DOD - Signup` is `120251562676280755`; the armed draft still points at the paused FOLMAOUR id.
