# Session log — dashboard truth audit (2026-06-04)

- **Branch:** `cursor/dashboard-truth-audit-2026-06-04`
- **PR:** #536 — https://github.com/matas-offpixel/meta-campaign-builder/pull/536
- **Type:** Audit-only (no production code changed). Single deliverable: `docs/dashboard-truth-audit-2026-06-04.md`.

## Scope
Audited 8 dashboard surfaces + 8 bugs (A–H) against the 2026-06-04 source-of-truth, on `main` HEAD `a3d6ac3`, with grep + Supabase MCP evidence. No code modified; `venue-spend-allocator.ts` and `lib/insights/meta.ts` read-only.

## Headline corrections to prompt premises
1. **Bug A inverted** — presale-overlap venues **over**-report by ≈ their `ad_spend_presale` (Birmingham +£1,359 … Newcastle +£1,400), not under-report. Portfolio `allocated+presale` = £86,479 vs truth £75,815 (+£10,664).
2. **Bug D mechanism** — London-Presale £878.26 IS in DB; dropped from Topline (`client-portal.tsx:200` omits `londonPresaleSpend`) + no venue card.
3. **Bug G mostly mitigated** — client surfaces read dedup'd lifetime cache, not daily SUM.
4. **`ticketing_purchase_events` empty (0 rows)** — proposed daily-tracker source not viable yet.
5. **Bug H mechanism** — topup is `ticket_sales_snapshots` source=`manual`, not daily_history; +43 = cron-gap snapshot leak / lifetime-tile day-over-day.

## Verification
- Supabase: per-venue `effective_paid` vs truth; cache vs daily-summed reach (2.3–6.4×); Manchester daily_history trajectory; `ticketing_purchase_events` count; Edinburgh presale/allocated overlap (0 days).
- Grep proof for every drift origin (file:line) in the audit doc.

## Anti-drift
No code change, no rollup writes, no CAMPAIGN_SPLITS-style proposals. Fix PRs sequenced in the doc for Matas to decide.
