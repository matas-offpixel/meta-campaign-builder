-- Migration 244 — the on-sale refresh, P4 PR C: scaling the Purchase campaign, copying an audience into it, and P5's verdicts on them
--
-- docs/design-record/2026-11-14-purchase-campaigns.html, PC4, PC5, PC6 and
-- HP4 / HP5.
--
-- 1. Two new line kinds:
--      scale_purchase  "Scale Purchase up / down": the Purchase campaign's
--                      daily rate doubled or halved, moved as lifetime
--                      between it and the main campaign (PC4).
--      copy_audience   a main-campaign ad set copied into the Purchase
--                      campaign, outside the pick test, no new money (PC4).
-- 2. A fourth outcome, no_verdict (PC6): a Purchase campaign judged on its
--    first 14 days with fewer than 3 purchases is recorded and doesn't count
--    towards a hit rate. Track records read right and wrong only, so nothing
--    else changes.
--
-- The kind CHECK keeps every kind 232 and 242 installed; the outcome CHECK
-- keeps 241's three. 243 (#1239, PR B) holds the ledger kinds this PR's
-- writes reuse (refresh_campaign_lifetime_budget_update, refresh_adset_create,
-- refresh_ad_create, adset_status_update). This PR is stacked on #1239.
--
-- Write only. Not applied from this branch. Ops applies from main.

alter table public.onsale_refresh_lines
  drop constraint if exists onsale_refresh_lines_kind_check;

alter table public.onsale_refresh_lines
  add constraint onsale_refresh_lines_kind_check
  check (kind in ('add_creative', 'claim_ready', 'pause_creative', 'bring_back_audience', 'missing_default', 'drop_audience', 'move_budget', 'purchase_campaign', 'scale_purchase', 'copy_audience'));

alter table public.onsale_refresh_outcomes
  drop constraint if exists onsale_refresh_outcomes_outcome_check;

alter table public.onsale_refresh_outcomes
  add constraint onsale_refresh_outcomes_outcome_check
  check (outcome in ('right', 'wrong', 'unknown', 'no_verdict'));
