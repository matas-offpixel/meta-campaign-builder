-- Migration 104: remove fabricated zero-value Mailchimp snapshots for Ironworks
--
-- PR #510 daily sync wrote email_subscribers = 0 for 10 Feb → 26 May when the
-- backward reconstruction hit an incomplete activity window. Those rows poison
-- the brand_campaign chart anchor (leadingAnchor skips zero registration days).
-- The daily sync (post fix) will repopulate accurate cumulative rows on next run.

delete from mailchimp_audience_snapshots
where event_id = '68535c85-0394-435f-9439-245dd2e87043'
  and email_subscribers = 0
  and snapshot_at < '2026-05-26';
