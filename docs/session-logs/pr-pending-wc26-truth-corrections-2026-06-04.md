# Session log — PR pending: wc26-truth-corrections-2026-06-04

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/wc26-truth-corrections-2026-06-04`

## Summary

Tactical WC26 dashboard corrections for client-facing truth (2026-06-04):

1. **Glasgow CAMPAIGN_SPLITS refresh** — snapshot 2026-06-03 (spend £7,784.08, O2 78.53% / SWG3 21.47%). Supersedes PR #529 / cc/glasgow-splits-refresh if not merged separately.
2. **Manual ticket topups** — executed in prod via Supabase MCP for external-channel gaps (O2 venue, SWG3 venue, Manchester SeeTickets). Rows use `source=manual`; `tickets_sold` stored as **cumulative** per fixture (prior latest + delta), not delta-only.

## Fix 2 — SQL executed (prod, 2026-06-04)

| Venue | INSERT rows | Delta topup | Post-fixture sum |
|---|---|---|---|
| WC26-GLASGOW-O2 | 3 | +403 | **1,397** |
| WC26-GLASGOW-SWG3 | 3 | +794 | **3,389** |
| WC26-MANCHESTER | 4 | +43 | **1,001** |

`external_event_id`: `venue_channel_topup_2026-06-04` (O2/SWG3), `seetickets_topup_2026-06-04` (Manchester).

**Note:** Prompt SQL inserted delta-only values; corrected immediately with UPDATE to `prior_latest + delta` because `ticket_sales_snapshots.tickets_sold` is cumulative per fixture.

Manchester delta is +43 (dashboard was 958, target 1,001), not +66 — prompt arithmetic `round(66/4)+2` totals 70.

## Validation

- [x] Idempotency pre-check: no existing topup rows
- [x] Post-insert ticket sums match targets
- [x] `event-code-adset-splits` tests updated for 2026-06-03 snapshot
- [ ] `npm run lint && npm run build`

## Deferred (Opus audit)

Brighton allocator, London-Onsale/Presale, PRESALE-overlap spend, reach/click inflation.
