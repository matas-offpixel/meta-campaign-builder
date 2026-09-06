# Session log — audit per-placement + BOOK_NOW alternative shapes

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/audit-per-placement-bookwow-alternative-shapes`

## Summary

Research audit (extends PR #571/#572) to find a Meta API payload delivering per-placement assets
(4:5→Feed, 9:16→Stories/Reels) WITH a strong ticketing CTA. Probed five hypothesised shapes via
validate_only + real-object persistence read-backs.

Outcome: literal `BOOK_NOW` cannot coexist with `asset_feed_spec` in one creative (hard block).
But the goal is achievable via two verified paths — a CTA swap to `BUY_TICKETS` (keeps the
existing AFS architecture) or separate placement-locked ad sets (keeps literal BOOK_NOW).

## Scope / files

- `docs/AUDIT_PER_PLACEMENT_BOOKNOW_ALTERNATIVES_2026-06-06.md` — full memo + probe ledger

## Validation

- No code changed. All Meta probe objects created during the audit were deleted (two probe
  creatives remain orphaned pre-purge; not serving).

## Key findings

1. Shape 1 (`placement_asset_customization_data`) — phantom field, doesn't exist.
2. Shape 2a (ad-level placement targeting) — accepted by validate_only but NOT persisted.
3. Shape 2b (separate placement-locked ad sets + standard BOOK_NOW) — VERIFIED, persists.
4. Shape 3 (multi/per-rule CTA in AFS) — refuted (one CTA per rule).
5. Shape 4 (DCO per-asset CTA) — refuted (AFS-no-rules still blocks BOOK_NOW).
6. Shape 5 (carousel) — passes BOOK_NOW but is not per-placement rendering.
7. BONUS: `BUY_TICKETS`, `GET_SHOWTIMES`, `ORDER_NOW`, `GET_OFFER` all pass + persist with AFS.
   Only `BOOK_NOW`/`BUY_NOW` are hard-blocked. `BUY_TICKETS` is the ideal ticketing CTA.

## Caveat / next step

Meta's Ads Manager Help Centre lists "Buy tickets" as unavailable for placement asset
customization, yet the Marketing API accepted + persisted it. Required gate before shipping
Path B: publish ONE real BUY_TICKETS + AFS ad and confirm it passes review and renders the
9:16 in Stories. Fall back to Path A (separate ad sets) if it fails.

## Methodology lesson

validate_only success is necessary but NOT sufficient — two shapes here returned success and
were then disproven by reading the persisted object back. Always read back.
