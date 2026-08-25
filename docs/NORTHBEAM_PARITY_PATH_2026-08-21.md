# Northbeam-parity path (first draft — SUPERSEDED)

> **STATUS: superseded twice.** First by `MULTICHANNEL_ENGINE_ROADMAP_2026-08-21.md` (v1),
> then by `MULTICHANNEL_ENGINE_ROADMAP_V2_2026-08-21.md` (canonical, funnel-first) after the
> Opus audit (PR #835). Retained as the original Northbeam product audit record.

## What Northbeam sells (audited 2026-08-21, northbeam.io)

1. **MTA** — first-party pixel + clicks + deterministic views; "all your channels, campaigns
   and ads in one view"; sales attribution; creative analytics; metrics explorer.
2. **MMM+** — *"daily optimizations and model training… adjust your forecasts and budget
   allocations daily, not quarterly"*; promo/seasonality sensitivity; *"the only MMM that can
   ingest native MTA data"*; forecasting before spend.
3. **Apex** — feeds their attribution data back into ad-platform algorithms (Meta and Axon
   only) to improve delivery. "No dev work required."

Architecture insight: MMM+ sits on top of MTA data. The model is only as good as the unified
spend/response dataset underneath. Northbeam cannot launch campaigns at all — launch tooling
is Off/Pixel's differentiator, not a gap.

## Original asset inventory (2026-08-21)

`event_daily_rollups` (per-event per-day Meta/TikTok/Google spend + tickets + signups) —
the MTA-lite dataset. Landing pages with per-client Meta Pixel + CAPI. Ticketing snapshots
(Eventbrite, 4thefans API, manual, xlsx). Three launch wizards. `lib/optimisation/` with
live gated Meta budget writes (#120). Budget pacing + Slack notify. Funnel planner +
`event_funnel_overrides`. Creative tagging + autotag. D2C brief-ingest parser.

(The five-phase plan originally here was folded into v1 and then reshaped by the audit and
the funnel-first correction — see v2 for the current path.)
