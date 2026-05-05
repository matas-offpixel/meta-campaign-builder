alter table report_shares
  add column if not exists show_creative_insights boolean not null default true,
  add column if not exists show_funnel_pacing boolean not null default true;

notify pgrst, 'reload schema';
