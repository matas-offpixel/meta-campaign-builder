-- Migration 169 — campaign_plan_*_launch.platform_ad_account_id
--
-- G30: identity prints the account the campaign actually runs on. After
-- launch that is the linked draft's account, not the client default the
-- resolver returns. Store it on the ledger at the live upsert so a later
-- draft edit cannot rewrite the sentence.
--
-- Backfill from the linked drafts. Meta: campaign_drafts.draft_json->'settings'
-- ->>'adAccountId' (then draft_json->'settings'->>'metaAdAccountId'). There is
-- no campaign_drafts.settings column. TikTok: tiktok_campaign_drafts.state
-- advertiserId / accountSetup.advertiserId. Google: google_ads_accounts
-- .google_customer_id via google_search_plans.google_ads_account_id (uuid FK).
--
-- Foundation only. Apply after review. Do not apply in this run.

alter table campaign_plan_meta_launch
  add column if not exists platform_ad_account_id text;

alter table campaign_plan_tiktok_launch
  add column if not exists platform_ad_account_id text;

alter table campaign_plan_google_launch
  add column if not exists platform_ad_account_id text;

comment on column campaign_plan_meta_launch.platform_ad_account_id is
  'Ad account the Meta campaign actually launched in (draft_json.settings.adAccountId). Identity reads this after launch, then the linked draft, never the resolver.';
comment on column campaign_plan_tiktok_launch.platform_ad_account_id is
  'Advertiser the TikTok campaign actually launched in. Identity reads this after launch when a draft exists.';
comment on column campaign_plan_google_launch.platform_ad_account_id is
  'Google Ads customer id (google_ads_accounts.google_customer_id), never the google_ads_accounts uuid FK.';

update campaign_plan_meta_launch l
set platform_ad_account_id = coalesce(
  nullif(trim(d.draft_json->'settings'->>'adAccountId'), ''),
  nullif(trim(d.draft_json->'settings'->>'metaAdAccountId'), '')
)
from campaign_drafts d
where l.draft_id = d.id
  and l.platform_ad_account_id is null
  and coalesce(
    nullif(trim(d.draft_json->'settings'->>'adAccountId'), ''),
    nullif(trim(d.draft_json->'settings'->>'metaAdAccountId'), '')
  ) is not null;

update campaign_plan_tiktok_launch l
set platform_ad_account_id = coalesce(
  nullif(trim(d.state->>'advertiserId'), ''),
  nullif(trim(d.state->'accountSetup'->>'advertiserId'), '')
)
from tiktok_campaign_drafts d
where l.draft_id = d.id
  and l.platform_ad_account_id is null
  and coalesce(
    nullif(trim(d.state->>'advertiserId'), ''),
    nullif(trim(d.state->'accountSetup'->>'advertiserId'), '')
  ) is not null;

update campaign_plan_google_launch l
set platform_ad_account_id = nullif(trim(a.google_customer_id), '')
from google_search_plans p
join google_ads_accounts a on a.id = p.google_ads_account_id
where l.draft_id = p.id
  and l.platform_ad_account_id is null
  and nullif(trim(a.google_customer_id), '') is not null;

notify pgrst, 'reload schema';
