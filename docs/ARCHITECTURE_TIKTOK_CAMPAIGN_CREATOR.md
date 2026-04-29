# TikTok Campaign Creator Architecture

## Scope

This foundation introduces the draft model, database tables, route skeleton, and component placeholders for a TikTok-native campaign creator. It deliberately does not implement launch behavior or call any TikTok write APIs.

## Route Decision

The wizard lives at `/tiktok-campaign/[id]`, separate from the Meta wizard at `/campaign/[id]`.

Why: TikTok and Meta share a broad hierarchy, but the mental model diverges quickly: TikTok identity, Spark Ads, Smart+ optimisation, music, video-first creative inputs, and audience primitives all need different fields. A separate route keeps the draft schema, validation, autosave, and eventual launch gate isolated.

Alternative rejected: a polymorphic `/campaign/[id]?platform=tiktok` route. That would reuse some navigation chrome, but it would force a platform switch into the existing Meta draft type and make every step branch on platform. That is harder to review, harder to test, and riskier for existing Meta campaign creation.

## TikTok Concepts That Do Not Map 1:1

- Identity: TikTok's advertiser identity/post-poster is not equivalent to a Meta Page. It needs its own selector and eventual `identity_id`.
- Spark Ads: boosted organic posts are a distinct creative mode. They should not be mixed with uploaded video assets in the same field.
- Smart+: TikTok's automated optimisation needs a first-class on/off and bid-strategy treatment, similar in spirit to Meta Advantage+ but not identical.
- Audiences: TikTok uses `interest_category_ids`, `interest_keyword_ids`, behaviour categories, lookalikes, and custom audiences with a shape that differs from Meta's page/custom/saved/interest grouping.
- Pixel events: TikTok pixel events have separate names and scopes. Do not reuse Meta pixel event enums.
- Hierarchy: TikTok is Campaign -> Ad Group -> Ad, but ad group budget, placement, optimisation, and identity parameters differ enough to require TikTok-specific types.

## Step Structure

0. Account setup: advertiser, identity, and pixel. Reads existing TikTok account data only.
1. Campaign setup: auto-prefixed `[event_code]` name, objective, optimisation goal.
2. Optimisation strategy: benchmarks, rules, guardrails, Smart+ on/off.
3. Audiences: interest categories, keyword interests, behaviours, lookalikes, custom audiences.
4. Creatives: video upload references, URL-based assets, captions, Spark Ads, and music-library placeholders.
5. Budget & schedule: ad-group budgets, pacing, schedule, allocation rules.
6. Assign creatives: ad-group to creative matrix.
7. Review & launch: pre-flight checks and feature-flagged launch. Real TikTok write calls remain out of scope until sign-off.

## Draft Tables

- `tiktok_campaign_drafts`: owner-scoped draft rows with `state jsonb` as the source of truth.
- `tiktok_campaign_templates`: reusable TikTok draft snapshots for cloning.

Both tables use `user_id` RLS matching the Meta `campaign_drafts` / `campaign_templates` posture.

## Event Naming Convention

Campaign names should auto-prepend `[event_code]` in the wizard. Reporting remains case-insensitive substring matching against the bare event code.

## Future API Surface

Reads can reuse existing TikTok account endpoints. Future write routes must be added only after sign-off and behind a feature flag:

- advertiser identity read helper (`/identity/get/`)
- pixel/event reads
- campaign create
- ad group create
- file upload
- creative/ad create
- launch orchestration with dry-run validation

## Spec Questions For Matas

1. Do we support Spark Ads in v1?
   Default: include a placeholder creative mode, but do not implement fields yet.
2. Should objectives be editable after launch?
   Default: no; lock objective post-launch.
3. Should one draft support multiple advertisers?
   Default: no; one advertiser per draft.
4. Should Smart+ be a bid strategy, an optimisation toggle, or both?
   Default: both type fields exist, UI decides later.
5. Should TikTok identity mirror the Meta `@PAGE_SLUG` display model?
   Default: yes, but implementation is deferred.
6. Should music selection be required for uploaded videos?
   Default: optional in v1.
7. Should the launch button appear before write APIs are enabled?
   Default: yes, disabled with a feature-flag note.
8. Should TikTok drafts appear in the existing campaign library?
   Default: not yet; separate library integration is a follow-up.

## Migration Plan

This PR adds only the draft/template tables. Future migrations likely need launch records, TikTok ad group templates, uploaded asset references, identity cache rows, pixel event cache rows, and launch audit logs.
