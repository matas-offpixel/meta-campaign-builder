-- Migration 242 — the on-sale refresh, P4 PR A: the Purchase campaign line
--
-- docs/design-record/2026-11-14-purchase-campaigns.html, PC1, PC2 and
-- HP1 / HP2.
--
-- 1. A new line kind, purchase_campaign: the card in Objective that says
--    exactly what Accept would build (PC2). PR A stores and shows it; the
--    gated create write is PR B's.
-- 2. A new reject reason, not_this_show ("Not this show"). PC2 adds it to
--    R4's four, on the Purchase campaign line only.
--
-- The rate Matas picks on the card (£5 or £10 a day, PC3) is stored on
-- Accept in the line's existing write jsonb (write.dailyGbp), so no new
-- column is read before this migration is applied.
--
-- Apply this before the PR A deploy runs a refresh in which a show reaches
-- the Proposed state: until it is applied, the purchase_campaign line
-- fails the kind CHECK and that event's proposal isn't stored. No show is
-- Proposed today (14 Nov).
--
-- 241 (#1229) is the latest on main. Nothing else claims 242.
--
-- Write only. Not applied from this branch. Ops applies from main.

alter table public.onsale_refresh_lines
  drop constraint if exists onsale_refresh_lines_kind_check;

alter table public.onsale_refresh_lines
  add constraint onsale_refresh_lines_kind_check
  check (kind in ('add_creative', 'claim_ready', 'pause_creative', 'bring_back_audience', 'missing_default', 'drop_audience', 'move_budget', 'purchase_campaign'));

alter table public.onsale_refresh_lines
  drop constraint if exists onsale_refresh_lines_reject_reason_check;

alter table public.onsale_refresh_lines
  add constraint onsale_refresh_lines_reject_reason_check
  check (reject_reason is null or reject_reason in ('too_early', 'wrong_creative', 'claim_not_right', 'other', 'not_this_show'));
