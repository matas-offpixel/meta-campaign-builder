# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Tool Ownership & Branch Convention

This repo is worked on by two coding tools — Claude Code (terminal) and Cursor (editor). To avoid conflicts and stale buffers, ownership is declared via branch prefix.

**Branch prefixes:**
- `cc/...` — Claude Code-owned branch. Only Claude Code edits files on this branch.
- `cursor/...` — Cursor-owned branch. Only Cursor edits files on this branch.

**Rules:**
1. **One tool per branch, end-to-end.** Whatever opens the branch finishes the branch. Never hand off mid-PR.
2. **Never edit files on a branch owned by the other tool.** If you're Claude Code and the current branch starts with `cursor/`, refuse the edit and ask the user to switch tools or open a new `cc/` branch.
3. **Never edit the same file in both tools on the same day**, even on different branches. Stale buffers cause real problems.
4. **Always pull `main` before opening a new branch.** Open `cc/...` and `cursor/...` branches off fresh `main`, never off another tool's branch.
5. **One PR per branch, no follow-up commits to a merged branch** (existing rule from PRs #104→#107).
6. **Worktrees for parallel work** — Claude Code in `~/meta-campaign-builder` and Cursor in `~/worktrees/...` keeps physical directories separate when both tools need to run at once. Close the editor before manual git surgery.

**Tool split heuristic** (also captured in user memory):
- Claude Code: single-file fixes with diagnosed root cause, tests, parser additions, mechanical refactors, documentation, log queries, MCP-driven ops work, 1–3 file changes.
- Cursor: multi-file architectural work (4+ files), new primitives, cross-cutting refactors, anything where the parallel diff-review UI earns its keep.

## Review loop

Visual changes run the review loop in `docs/design-record/README.md`: design record → build prompt → PR + CI evidence → return → design verdict → fix loop on the same branch → squash merge → live check → migrate from `main` once the sha256 matches. Live check — after the deploy is READY, the ops thread opens the changed feature on prod in Matas's Chrome, runs the real flow on a live event (no launches, no publishing, no spend beyond writer/render pennies), and reports PASS / FAIL with what it saw; a FAIL comes with the follow-up prompt for the builder. Creative Lab rules and components: `docs/creative-lab/design-rules.md`.

Any new surface or changed words in the MML canvas, drawers, library, reports, event page / Creative Lab or `/admin` gets a design record in `docs/design-record/` first. Records are never edited after merge; a re-ruling gets a new record.

## Project

Internal tool for building Meta/Facebook ad campaigns for event marketing. An 8-step campaign creation wizard with Supabase auth/persistence and a Meta API integration layer.

## Commands

```bash
npm run dev      # development server at localhost:3000
npm run build    # production build
npm run lint     # ESLint
```

## Architecture

**Tech stack:** Next.js 16 + React 19, Tailwind CSS v4, TypeScript strict, Supabase (`@supabase/ssr`), `lucide-react`

> See `docs/PROJECT_CONTEXT.md` for the full architecture reference.

### Routes

| Path | Purpose |
|------|---------|
| `/` | Campaign Library (Drafts / Published / Archived / Templates tabs) |
| `/campaign/[id]` | Standalone Meta draft — same `Drawer` as the canvas (`variant="page"`), plus Launch |
| `/login` | Magic link, invite-only email allowlist |
| `/auth/callback` | Supabase code exchange |
| `/auth/logout` | Sign out |
| `/mml` | MML (Multi Media Launcher) list — one row per `campaign_plans` row. First item under Platforms in the nav |
| `/mml/[id]` | MML **canvas** — one scrolling page, seven numbered sections: ① Event & promoter · ② Creatives · ③ Copy · ④ Budget & schedule · ⑤ Locations & placements · ⑥ Channels · ⑦ Launch. ⑥ has one card per channel; `Adjust` opens its `Drawer` (`?drawer=f\|tt\|g`). ⑦ is one `Launch all (paused)` button behind `ENABLE_PLAN_FANOUT`, with blockers grouped by channel under it. ② ③ ⑤ are placeholders until M2–M4. Spec: `docs/session-logs/mml-multi-media-launcher-spec-2026-10-08.md` |
| `/plans` → `/mml`, `/plan/[id]` → `/mml/[id]` | Permanent (308) redirects in `next.config.ts` (`MML_LEGACY_REDIRECTS`, `lib/plan/mml-routes.ts`). The query string is kept, so `?drawer=tt` deep links still land |
| `/tiktok-campaign/[id]` | Standalone TikTok draft — same TikTok `Drawer` (`variant="page"`), plus Launch |
| `/google-search/[id]` | Standalone Google Search tree — same Google `Drawer` (`variant="page"`), plus Push |
| `/google-video/[id]` | YouTube video plan: Settings → Targeting → Placements → Ads → Review. Review downloads a Google Ads Editor CSV. No Google API writes. See "Google video plans" below |
| `/d2c/brief-ingest` | Upload a PDF (or paste text) brief → background parse into a scheduled D2C campaign |
| `/d2c/event/[id]` | D2C orchestration: resolved artwork, WhatsApp community URL paste, per-send Matas approval |
| `/l/[clientSlug]/[eventSlug]` | Public fan-facing event landing page (Supreme renderer) |
| `/api/mcp` + `/oauth/authorize` | Off/Pixel MCP (M1 read tools, scope `mcp:read`; M2 draft tools, scope `mcp:draft`: campaign drafts in the app database only; M3a meta tools, scope `mcp:meta`, Matas only: launch, uploads to Meta, event edits, each on his chat yes; M3b live changes on the same scope: get_live, pause / resume, set_budget (now or scheduled), move_budget, rename, add creatives or audiences to a stage, Meta A/B tests; M3c retargeting on the same scope: plan_retargeting reads, create_show_campaigns on his chat yes). Streamable HTTP, stateless, protocol 2025-11-25; the app is its own OAuth server on the Supabase login (DCR for Claude's callback and loopback, PKCE S256, opaque tokens stored as SHA-256). Operators only. Off unless `ENABLE_MCP=1`. See `docs/mcp/README.md` and migration 268 |
| `/business-managers` | Operator BM Asset Sync tool: enumerate client Business Manager pages, flag missing access, one-click ADVERTISER grants. Auth = operator session + allowlist (NOT the client `/admin/*` namespace). See migration 145 |
| `/admin/login` + `/admin/auth/callback` | CLIENT dashboard magic-link login (OP909 — distinct from operator `/login`) |
| `/admin/[clientSlug]/*` | Client self-service dashboard: pages, fans, insights, integrations, settings. Auth = session + `client_users` membership + slug match (403 on mismatch). See `docs/ADMIN_DASHBOARD_ARCHITECTURE.md` |

### Google video plans

The Google Ads API can read and report on Video campaigns, but it cannot create or change them ([Video campaigns, API limitations](https://developers.google.com/google-ads/api/docs/video/overview)). So a YouTube video plan is never pushed. The import (`POST /api/google-search/import`, `detectWorkbookKind` → `video`, `lib/google-video/xlsx-import.ts`) stores it in the `google_video_*` tables (migrations 190, 191). Review (`lib/google-video/validation.ts`) gates `POST /api/google-video/[id]/export`, which returns a Google Ads Editor CSV (`lib/google-video/editor-export.ts`) and sets `status = 'exported'` and `exported_at`. The operator imports the CSV in Editor (Get recent changes → Account → Import → From file → review → Post). Every header and fixed value is copied from a campaign Editor exported with 0 errors (`lib/google-video/__tests__/fixtures/editor-template-export.tsv`, UTF-16LE TSV, 111 columns; a test fails on any header not in it). Editor deprecates Manual CPV, so the file writes Target CPV (`cpv_bid` → ad group `Target CPV`), `Responsive video` ad groups, and `Responsive video ad` ads with `Video ID 1`, `Call to action / Headline / Long headline / Description 1..5` (slot 1 is the sheet's value, slots 2..5 `google_video_ads.extra_copy`) and a required `Business name` (`google_video_plans.business_name`; import defaults it from the event's client, else venue; Review blocks without it). With start and end dates the budget is always Budget type `Campaign total` (Editor warns on an average daily budget with an end date). A plan `total_budget` is split across the enabled campaigns (by each campaign's own daily budget when every enabled campaign has one, otherwise equally; 2 dp; the parts sum to the plan total, remainder on the largest). A paused campaign stays out of that split: its own daily × days when it has one. With no daily of its own, Review blocks the download — the template's only campaign row has a Budget (`150.00`), so a blank or zero budget is not written. With no plan total, the daily budget × inclusive days (2 dp) is written on each campaign. `Daily` (imported as Editor's "Avg. daily") only without an end date. `EU political ads` is always `Doesn't have EU political ads`. YouTube placements are not written into `Website`: the Editor template has no YouTube video or channel column, and Editor rejects a YouTube URL there (`Invalid placement URL`). Review tells the operator to add video placements as the 11-character Video ID only. Ad `Video ID 1` is the ad's own video, not a placement. Locations go by ID from `lib/google-ads/verified-geotargets.ts`, which the Editor file and the Search fallback map both use. Every ID is in the 2026-08-12 geotargets extract. English region names are not given a nearby ID (9049069 is Estepona, Spain, and is not used). Google has no English region targets, so South East England is left out with a warning. The file writes no TV screen or location bid modifiers (Editor rejected them), no frequency cap, no Google TV switch and no logo. Review lists those as manual steps: Include Google TV: Disabled, each location bid adjustment, the frequency cap, the logo, and the sheet settings the file can't carry.

### WhatsApp community button URL

New D2C templates use `https://crqln.com/j/{code}` (`COMMUNITY_REDIRECT_BASE` in `lib/d2c/bird/templates/from-event.ts`). That path is an HTML interstitial on cirqlin, not a 302.

`app.offpixel.co.uk/j/{code}` is deprecated as of Sep 2026 after WhatsApp's classifier began flagging the offpixel subdomain. The offpixel URL still resolves for messages already out. Do not use it for new templates. Do not edit already-approved Bird templates (Meta re-approval) or already-scheduled Mailchimp campaigns.

### Canvas + drawers

`/mml/[id]`, `/campaign/[id]`, `/tiktok-campaign/[id]`, and `/google-search/[id]` all mount `components/viz/drawer.tsx`. The old eight-step ladders are gone; each drawer is a tab bar.

| Route | Drawer | Tabs |
|---|---|---|
| `/mml/[id]` + `/campaign/[id]` | Meta (`components/plan/meta-drawer.tsx`) | `👥 audiences` · `▤ creatives` · `⊞ ad sets` · `details` disclosure |
| `/mml/[id]` + `/tiktok-campaign/[id]` | TikTok (`components/plan/tiktok-drawer.tsx`) | `▶ video` · `👥 refine` · `⊞ assign` (only when videos > 1) · `details` |
| `/mml/[id]` + `/google-search/[id]` | Google (`components/plan/google-drawer.tsx`) | `⌕ keywords` · `¶ copy` · `details` |

Standalone Meta still launches ACTIVE from `ReviewLaunch` (launch panel only). Standalone TikTok keeps `ReviewLaunchStep`. Standalone Google keeps `PushStep`. Plan-linked drafts launch from the canvas, paused. `validateStep` still gates drawer blockers. The chrome codemod (`scripts/codemod-step-chrome.mjs`) is gone — chrome is deleted, not hidden.

### Key types (`lib/types.ts`)

`CampaignDraft` is the root state: `settings`, `audiences`, `creatives`, `optimisationStrategy`, `budgetSchedule`, `adSetSuggestions`, `creativeAssignments`, `status`, `id`, timestamps. Status: `"draft" | "published" | "archived"`.

### Persistence

- **localStorage** — `lib/autosave.ts` (`saveDraftToStorage` / `loadDraftFromStorage`)
- **Supabase** — `lib/db/drafts.ts` (CRUD on `campaign_drafts`), `lib/db/templates.ts`
- `migrateDraft()` in `lib/autosave.ts` handles schema evolution on load
- **D2C** — `lib/db/d2c.ts` (CRUD on `d2c_connections`, `d2c_scheduled_sends`,
  `d2c_event_copy`, `d2c_brief_ingest_jobs`)

### Archived clients

`clients.status = 'archived'` hides a client from default dashboard views (clients list, Today, events, overview, plans, library Drafts/Published, Armed) and from every cron (rollup-sync, refresh-active-creatives, show-week-burst, refresh-creative-insights, scan-enhancement-flags, budget-pacing, optimisation-tick, ad-daily-insights, Mailchimp, funnel-pacing, portal snapshots). Events, drafts, and plans are archived through their client (`campaign_drafts.client_id`, else the draft's event). Rows with no client stay visible. `paused` counts as active. The clients-list "Archived" / "All" filters and an explicit `clientId` still show archived clients. Share links and the client portal never check status. Use `lib/db/client-status.ts` (`ARCHIVED`, `activeClientFilter`, `loadArchivedClientIds`, `loadArchivedClientScope`). `lib/db/__tests__/client-status-guard.test.ts` fails on inline client-status `"archived"` literals.

Archiving a client fully also means **pausing its ticketing connections**:
`sync-ticketing` selects `.eq("status","active")`, so a connection left on
`error` is skipped but still reads as a broken feed someone should fix.
`status` is CHECK-constrained to `active | paused | error` — there is no
`disabled`. 4theFans (`37906506-56b7-4d58-ab62-1b042e2b561a`) was archived
this way on 14 Oct 2026: both connections (`fourthefans`, `eventbrite`) set
to `paused`, `last_error` preserved. Its learning contribution needed no
change — `lib/learning/joins.ts` already drops archived-client facts before
`tag_performance`, `creative_scores` and `client_funnel_benchmarks` are
recomputed, so cross-client `vertical`/`all` scopes re-aggregate without it.
The cron alarms exclude archived clients by rule for the same reason: an
archived client must never make a cron look broken.

### Meta API layer

- `lib/meta/` — `client.ts`, `campaign.ts`, `adset.ts`, `creative.ts`, `upload.ts`
- `app/api/meta/*` — route handlers for ad accounts, pages, audiences, pixels, campaign creation, ad sets, creatives, asset upload, launch
- `lib/hooks/` — `useMeta`, `useCreateCampaign`, `useCreateAdSets`, `useCreateCreativesAndAds`, `useUploadAsset`, `useLaunchCampaign`

Step 6 Daily / Lifetime and Ad set level / Campaign level (CBO) are live-wired. A launch sends `lifetime_budget` plus ad set `end_time`, or a campaign `daily_budget` / `lifetime_budget` with `LOWEST_COST_WITHOUT_CAP`, when those toggles are set. They used to be stored on the draft and ignored. Campaign `stop_time` is read-only on Marketing API v21.0; the end date Meta keeps is the ad set `end_time`. Every ad set the app creates goes through `createMetaAdSet` / `createMetaAdSets` (`lib/meta/client.ts`), which send `targeting.targeting_automation.individual_setting.geo = 0` (location expansion, "Reach more people likely to respond to your ads", off; merged beside the age suggestion's `age: 1`, `lib/meta/geo-expansion.ts`), and the launch, create-adsets, on-sale refresh apply and creative-test approve results read `targeting` back once per ≤ 50 created ad sets and list in `locationExpansion` any Meta didn't keep at 0 or that couldn't be read (read-only, never a retry write).

### Auth

`proxy.ts` (Next.js 16 middleware) calls `lib/supabase/proxy.ts` to refresh sessions and guard routes. Public paths in `lib/auth/public-routes.ts` (`/login`, `/auth/*`). Three Supabase clients: `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (server components/route handlers), `lib/supabase/proxy.ts` (middleware only).

### Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
TIKTOK_APP_ID=
TIKTOK_APP_SECRET=
TIKTOK_REDIRECT_URI=
TIKTOK_TOKEN_KEY=
TIKTOK_VIDEO_UPLOAD_MODE=
META_VIDEO_UPLOAD_MODE=
OFFPIXEL_TIKTOK_WRITES_ENABLED=
OFFPIXEL_META_AUDIENCE_WRITES_ENABLED=
OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED=
OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED=
OFFPIXEL_META_TREE_ADD_WRITES_ENABLED=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REDIRECT_URI=
GOOGLE_ADS_TOKEN_KEY=
EVENTBRITE_TOKEN_KEY=
ANTHROPIC_API_KEY=
ENABLE_AI_AUTOTAG=
DROPBOX_REFRESH_TOKEN=
DROPBOX_APP_KEY=
DROPBOX_APP_SECRET=
GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY=
GOOGLE_DRIVE_EXPORT_DRIVE_ID=
ENABLE_MULTI_PLACEMENT_ASSETS=
MAILCHIMP_WEBHOOK_SECRET=
CIRQLIN_PARTNER_READ_SECRET=
CIRQLIN_PARTNER_HASHES_SECRET=
CIRQLIN_TO_DASHBOARD_BEARER=
CIRQLIN_API_BASE=
D2C_TOKEN_KEY=
D2C_BRIEF_PARSER_MODEL=
CREATIVE_LAB_WRITER_MODEL=
CREATIVE_LAB_LAUNCH_ENABLED=
CREATIVE_LAB_IG_AUTO_IMPORT=
BIRD_API_BASE=
FEATURE_D2C_LIVE=
LANDING_PAGES_TOKEN_KEY=
LANDING_PAGES_HASH_SALT=
LANDING_PAGES_TURNSTILE_SITE_KEY=
LANDING_PAGES_TURNSTILE_SECRET_KEY=
LANDING_PAGES_TURNSTILE_REQUIRED=
LANDING_PAGES_SIGNUP_RATE_MAX=
LANDING_PAGES_SIGNUP_RATE_WINDOW_MINUTES=
LANDING_PAGES_META_API_VERSION=
BM_TOKEN_KEY=
FACEBOOK_OAUTH_SCOPES=
ENABLE_META_THUMBNAIL_FETCH=
ENABLE_TIKTOK_THUMBNAIL_FETCH=
ENABLE_OPTIMISATION_AUTOMATION=
ENABLE_OPTIMISATION_WRITES=
ENABLE_OPTIMISATION_PAUSE_WRITES=
ENABLE_SLACK_NOTIFICATIONS=
SLACK_CHANNEL_ADS_OPS_ENABLED=
SLACK_CHANNEL_ADS_URGENT_ENABLED=
SLACK_CHANNEL_ADS_AUTOMATION_ENABLED=
SLACK_WEBHOOK_ADS_OPS=
SLACK_WEBHOOK_ADS_URGENT=
SLACK_WEBHOOK_ADS_AUTOMATION=
ENABLE_BUDGET_PACING_ALERTS=
ENABLE_AD_DAILY_INSIGHTS=
ENABLE_AD_COPY_CAPTURE=
ENABLE_LEARNING_REFRESH=
ENABLE_LEARNING_FINDINGS=
ENABLE_LEARNING_DIGEST=
ENABLE_GOOGLE_ADS_DAILY_INSIGHTS=
ENABLE_ONSALE_REFRESH=
ENABLE_RETARGETING_READ=
ENABLE_CREATIVE_TESTS_READ=
CREATIVE_TESTS_READ_WRITES_ENABLED=
CREATIVE_TESTS_CREATE_ENABLED=
OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED=
REMOTION_AWS_ACCESS_KEY_ID=
REMOTION_AWS_SECRET_ACCESS_KEY=
REMOTION_AWS_REGION=
REMOTION_LAMBDA_SERVE_URL=
ENABLE_MCP=
```

> **`ENABLE_MCP`** must be exactly `"1"` to serve the Off/Pixel MCP (`/api/mcp`), its OAuth endpoints (`/api/oauth/register`, `/api/oauth/token`, `/api/oauth/revoke`), the consent page (`/oauth/authorize`) and the `/.well-known/oauth-*` metadata. Unset or anything else = 404 on all of them, which is also the kill switch. M1's eight tools are read-only (`readOnlyHint`, scope `mcp:read`). The draft tools, M2's eight and M2b's eight (scope `mcp:draft`, operators; `lib/mcp/tools/draft-*.ts`), change `campaign_drafts` rows with status `draft` only, through `lib/mcp/drafts/write.ts`: one guarded `UPDATE … WHERE id AND user_id AND status = 'draft' AND updated_at = …` (the caller passes get_draft's `updatedAt`; a miss is "changed since you read it" or "not a draft", never a blind write). They reuse the app's own paths (replicateDraft, Step 5's location helpers and the Leeds pin, the Budget card's split, the Drive picker's copy into Storage; M2b: the Campaign step's objective change `lib/wizard/objective-change.ts`, Step 5's row edits and `appendBlankAdSet`, the Assign step's `assignAllCreatives`, the Audiences step's group edits with ad sets following through `lib/wizard/follow-audience-groups.ts`, `takeIdentity`, the library's `buildDuplicatedCampaign`) and call no Meta, TikTok, Google, Slack or D2C, except three GETs in `lib/mcp/graph-reads.ts` (location search, interest search, the ad account's `promote_pages`). `set_draft_ad_sets` refuses an enabled ad set under £8 a day unless `override` with `override_reason`, written into the `mcp_actions` row. Archive is the library's Archive (status column only). After every write the launch checks run (`runLaunchGuard`, database reads only). `apply_audience_template` adds a confirmed template's Reused audiences by Meta id on #1363's resolver (`lib/mcp/drafts/templates.ts`; one `SWITCH(#1375)` line in `draft-edit.ts` moves it to #1375's apply once that merges). A read-only grant gets 403 `insufficient_scope` with `scope="mcp:read mcp:draft"` on any draft tool and keeps reading. The guard test fails on any write outside `mcp_actions`, `mcp_oauth_*`, `campaign_drafts` (from `drafts/write.ts`) and the Drive picker's copy. Every call is checked for an unexpired, unrevoked token bound to this resource, a user still in `OPERATOR_USER_IDS`, and the per-grant rate limit (60 a minute, 600 an hour, counted from `mcp_actions`), and every tool call is an `mcp_actions` row with secrets stripped. M3a (scope `mcp:meta`, `MATAS_USER_IDS` only, re-checked on every call; another operator's consent is issued without it): `launch_draft` (Review & Launch's route through `launchCampaignAs`; `paused` is the route's `createPaused`), `upload_draft_assets` and `update_event` (the event form's save, five fields, `lib/mcp/meta/event-write.ts`). Each takes `approval: { asked, answer }` (Matas's chat yes, his 25 Nov ruling, replacing TD1–TD2's Today gate), stored on its `mcp_actions` row with `approval_source = 'claude_prompt'`; missing → refused. A live launch is refused when the show has no spend ceiling or its committed spend with the draft would pass it (PR D, Matas 26 Nov: "the ceiling is the campaign budget"; `lib/mcp/meta/show-ceiling.ts`, migration 274): committed spend is spent to date (`ad_daily_insights` over the show's campaigns, paged) + its live lifetime budgets left + its live daily budgets × London days to their end or show day (read from Meta, GETs only) + the change. The ceiling is the show's own `show_spend_ceilings` row and/or its group's (a total shared by the group's shows, `show_spend_ceiling_events`), else the show's default by exact code (`SHOW_DEFAULTS`: P26-BDAY £4,500; no other P26 code has one), else the brand default by code prefix (`BRAND_DEFAULTS`: NX £3,000, ES £2,500, EBR £2,500, AS £2,000; DHB none), both in code, else none, refused. `scripts/set-show-ceiling.mts` sets overrides and groups (dry run unless `--apply`). `client_spend_ceilings` and `scripts/set-client-ceiling.mts` stay; nothing reads them. M3b is on (record `2026-11-26-mcp-m3b-today`, MB4: `LIVE_CHANGES_SHIPPED` in `lib/mcp/live/shipped.ts` and `TODAY_UNDO_SHIPPED` in `lib/mcp/meta/today-undo.ts` are true together, code constants, not env, and a test pins them together; either set false makes all eleven tools answer "Refused: this is switched off in Off/Pixel. Nothing was sent to Meta." and the scheduled-changes cron apply nothing). Today's "Claude's changes" (`components/dashboard/today/claude-render-log.tsx`, Matas only) is FC1's log with M3b's rows (`lib/mcp/today/`: `log.ts` draws, `load.ts` reads, `words.ts` is the record's rows word for word): one row per connector Meta change today (launch_draft and M3b's pause / resume on campaigns, ad sets and ads, Change budget, Move budget, Rename, Add creatives, Add audiences, Start an A/B test), newest first, with "Approved in Claude" and What Claude asked from the `mcp_actions` row; refusals Matas acts on muted (no approval, ceiling, no ceiling, switch, launch checks), the ones that only correct Claude's input, reads, no-ops and `cancel_scheduled` left out; scheduled budget changes waiting at the top with Cancel (`cancelFromToday`, the same guard as `cancel_scheduled`, marked `outcome.cancelled_by`), then in the day's log at their run time ("Ran as scheduled", Done with Undo, Skipped · {reason}, Failed). Undo (`lib/mcp/today/undo.ts`, the server action `app/(dashboard)/today/claude-actions.ts`, Matas only) runs the pair through `realLiveDeps` keyed `undo:{row}`: pause ↔ resume, a budget back (daily, lifetime, scheduled), a whole move back, a rename back, and status DELETED on paused objects Claude made (a paused launch's campaign, paused ads), confirmed once; never on added audiences, a part-done move or a test. It re-reads and re-places the object first ("Changed since, so Undo is off."), meets the ceiling through `checkLiveCeiling` when it starts spend, and logs one `mcp_actions` row (tool `today_undo`, `approval_source = 'today'`). A budget that changed during a scheduled write is skipped, not failed. M3b (scope `mcp:meta`, `MATAS_USER_IDS` only) changes live objects in an event's campaign tree, each through its campaign's published draft on `meta_write_idempotency` and the app's own path and switch (`lib/mcp/live/`, `lib/mcp/tools/live-*.ts`): `get_live` and `list_scheduled` read; `pause` / `resume` (ad sets `OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED`, ads `OFFPIXEL_META_AD_STATUS_WRITES_ENABLED`, campaigns `lib/meta/campaign-status-write.ts` behind the ad-set switch; a resume of something paused outside the app is refused unless `asked` says so), `set_budget` (the optimisation budget write, `ENABLE_OPTIMISATION_WRITES`, `lib/meta/budget-write.ts`; `at` stores it in `scheduled_meta_changes`, migration 271, applied once by `/api/cron/mcp-scheduled-changes` every 15 minutes while `ENABLE_MCP=1`, skipped when the object changed since), `cancel_scheduled`, `move_budget` (the on-sale refresh's `moveAdSetDailyBudget`), `rename` (`lib/meta/object-name-write.ts`), `add_creatives_to_stage` (`bulkAttachAs` with `tree`, `OFFPIXEL_META_TREE_ADD_WRITES_ENABLED`; new ads paused unless `live`), `add_audience_to_stage` (`adsetAudienceAs`, `OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED`; Advantage+ stays on) — both stage adds read back the ad sets they reached and tell Claude, per ad set, when location expansion is on (`targeting_automation.individual_setting.geo` 1) or a retargeting ad set runs Advantage+ suggestions; they never change an ad set's targeting (`lib/mcp/live/targeting-check.ts`, Matas's 26 Nov plan item 2) and `create_split_test` (`lib/meta/ad-study.ts`). Resume, live ads, a budget up and a move that raises committed spend check the show's spend ceiling the same way; a cut, a neutral move, a pause or a rename never does. Any account the show's counted spend or budgets sit on that isn't in £ is refused. The MCP reaches Meta only through `lib/mcp/meta-deps.ts` and M3c's `lib/mcp/audience-deps.ts`. M3c (scope `mcp:meta`, `MATAS_USER_IDS` only; creating an audience or asking for access spends nothing, so no ceiling): `list_audiences` (an event's or one of his accounts' custom audiences: Meta's own and the app's, name, subtype, retention, size band, delivery) and `audience_sources` (the pixel the show's ads optimise on, the most spend over 14 days as the purchase read picks it, and whether it had Purchase, InitiateCheckout and CompleteRegistration in 28 days; CIRQLIN's page links, else `ticket_url` / `signup_url`; the promoter's Pages (the client's default Pages and the Pages its drafts run from) and each lineup act's (`artists.meta_page_id`, else the account's Page of the same name), each accessible or "needs advertiser access" by the builder's `resolvePageAccess`, with page_liked / INSTAGRAM_PROFILE_FOLLOW followers offered or already there; an act's Page with no access gets the `request_page_access` step and a heads-up email, its Instagram the manual Business Suite step; and `clientSources`, every Page and Instagram account the client's Business Manager owns or has shared in, with `genre_family` where known from the act's shows, the shape Job 4's page-group seed reads, `lib/mcp/audiences/client-sources.ts`) read; `create_audiences` makes up to 30 through the Audience Builder (`createAudienceDraft` then `createMetaCustomAudience` on the service-role client, `OFFPIXEL_META_AUDIENCE_WRITES_ENABLED`, seed grants off), each a `meta_custom_audiences` row with `event_id` and `client_id`, named "{code} · {source} · {n} days" ("all time" for followers), and lookalikes (GB, 1 %, one per source audience on the account, "{code} · {source} lookalike · 1 % UK"; a source Meta calls too small is refused); an app row or a Meta audience with the same rule (a lookalike: the same origin, country and ratio, any name) is reused, matched against the account's whole list, and one spec that can't be built (a source without access included) refuses the call with nothing made; `request_page_access` posts `/{client_business_id}/client_pages` as Matas (his `user_facebook_tokens` token, `pages_manage_metadata`, an admin there) from the client's own Business Manager (`client_business_managers.client_id` or, since migration 276, a `client_business_manager_links` row, so one BM can serve several clients, e.g. LWE for Junction 2 and Ironworks; read through `lib/bm/client-links.ts`, which the BM page-scan's archived-client rule and the launch checks use too; linked by `scripts/link-client-business-managers.mts`, dry run unless `--apply`), never Off/Pixel's own businesses, 944651277948334 and 237857750137825 (one constant, `OFF_PIXEL_BUSINESS_IDS` in `lib/meta/page-access-request.ts`, refused in the helper and the tool), on `meta_write_idempotency` as `page_access_request` (migration 273), at most 5 in 24 hours a business (counted on the ledger); `pending_access` reads `/{business}/pending_client_pages`. Both writes take `approval`, follow M3b's switch (`LIVE_CHANGES_SHIPPED`) and are logged on Today as FC1 rows (`lib/mcp/today/log.ts`: "Make audiences · {code}" and "Ask for Page access · {code}", the 12 rows ruled 27 Nov with #1400; no Undo; an all-reused create is no change and isn't a row). Files in Storage go to Meta at Launch, in the app and the connector (`lib/creatives/stored-at-launch.ts`, `lib/plan/stored-assets-meta.ts`, `POST /api/meta/draft-assets`): a pending slot with a Storage copy is not a blocker; a failed upload stops the launch as "Upload failed — retry or remove". M2's `attach_drive_creatives` takes files anywhere in the shared drive and `pairs` (4:5 or 1:1 feed + 9:16, one Dual ad); `set_draft_name` is the Campaign step's name. M3d-a (scope `mcp:draft`, through the pinned seam `lib/mcp/shows-deps.ts`): `create_event` and `create_client` are the event and clients forms' create (a sub-brand is its own client with `clients.parent_client_id`, migration 272, applied), `set_lineup` is the Lab's lineup save (`saveLabLineup`, a new act by its Spotify id through `addSpotifyToLineup`), and `get_releases` / `set_release` are the Releases card's read and save (`postReleaseAs`), answering with the claims its ladder gives now (a claim whose trigger isn't met comes back marked not yet). M3d-b (scope `mcp:draft`, `lib/mcp/tools/lab.ts`) reaches the Lab only through the pinned seam `lib/mcp/lab-deps.ts`: `list_tracks` reads the act's `02 Source / Audio` folder first as the Snippet tab does, `set_track_drop` is its drop edit (`saveAudioEdit`, `drop_source` operator), `list_clips` / `set_clip_owner` are render_package's clips and the Clips card's owner write (`saveClipOwner`; another client's footage refused), and `render_package` takes `picks.trackId`. M3d-c's `upload_to_event_folder` (scope `mcp:draft`) puts one file into one of a show's own Drive folders (01 Open files, 3 On sale, 02 Source / Artist clips or Audio / {artist}, an existing w/c {owner} / Videos | Statics folder) as the service account: a shared-drive file is copied (files.copy) or a Storage file on one of the show's drafts is uploaded, only the client's own files or the artist library (`lib/drive/file-owner.ts`), marked as the connector's own (`offpixel_placed_by = mcp`, never the export's `offpixel_kind` skip tag), so the Drive pickup and the Snippet scan read a clip in Artist clips or a track in Audio in like a hand-dropped file, and a file in 01 Open files goes to the kit audit as one dropped by hand does; only 02 Source reaches the Lab (Matas, 26 Nov); it never shares, moves, renames, deletes or makes a folder, and reaches Drive only through `lib/mcp/folder-in-deps.ts`. M3d-d's `strict_audit` (scope `mcp:read`, reads only) lists live ad sets (ACTIVE or IN_PROCESS) whose launch asked for Advantage+ suggestions while Meta now shows `advantage_audience` 0, from `launched_ad_sets` and their drafts plus one Graph GET per ≤ 50 ad sets (`readAdSetsById` in `lib/mcp/graph-reads.ts`, counted as `metaGets`). M3c (scope `mcp:meta`, `MATAS_USER_IDS` only, behind the M3b switch `switchedOffUntilShipped`, now on) is retargeting from the connector, from the funnel record (`docs/design-record/2026-11-26-retargeting-funnel.html`, RF1–RF9), through the pinned seam `lib/mcp/retargeting-deps.ts`: `plan_retargeting(event | events[] | "live")` runs the Retargeting campaign's 08:00 read as a dry run (`runRetargetingRead` with `dryRun`, Meta GETs with the operator's token, nothing written) and answers RF9's lines; `create_show_campaigns(event, mode, approval)` builds the show's `{code} · Retargeting` through `lib/retargeting/funnel-apply.ts` (paused moves nothing; live checks the ceiling on the change in the show's total, lowers prospecting, switches on and stores each stretch step in `scheduled_meta_changes` with the chat yes). Its seams are the audience tools' create (`lib/mcp/audience-deps.ts`, lookalikes included), `insertScheduled` (M3b) and the per-show ceiling (migration 274). Since #1402 (`docs/design-record/2026-11-26-retargeting-two-campaigns.html`, TC1–TC9) every show gets two campaigns (`SHOW_CAMPAIGNS_RULED` true in `lib/retargeting/show-campaigns.ts`; false goes back to one): `{code} · Wider` (Advantage+ with suggestions, one CBO lifetime budget, (show daily − Retargeting) × days to the show, or to on-sale for a presale show; Broad, Similar pages, Interests, Lookalikes) and `{code} · Retargeting` (Advantage+ off, daily: Similar · Cold · Warm · Hot at Matas's split). Each stretch step raises Retargeting and lowers Wider's lifetime by the step × days left, never under £1.00 a day per Wider ad set (a scheduled change, Today's MB1 row). Similar is the show's genre page group (`page_groups`, Matas confirms each, 365 days, ≤ 5 Pages an audience); no genre, no confirmed group or a group under Meta's minimum skips it and its share goes to Cold. A group confirmed (or grown past the minimum) after the build brings Similar back at the next stretch step (Matas, 27 Nov): the 08:00 read adds its ad set through the create path and its gates as the event's owner (`addSimilarAtStep`, `lib/retargeting/similar-step-deps.ts`), lowers Cold first, switches Similar on last and re-sizes the later steps; a refusal leaves the share in Cold and says why. The venue's Page and the promoter's brand Pages join Cold, Warm and Hot with the lineup (TC9) and never a group; plan_retargeting lists each show's matched Pages. Presale shows (announced, not on sale) optimise on CompleteRegistration and leave sign-ups out of both. create_show_campaigns never pauses or folds existing prospecting; a live create is refused while it still runs. The page-group seed is `scripts/page-groups-seed.mts --genres FILE` (confirmed rows only; dry run unless `--apply`). Since the 26 Nov dry run (Matas, 27 Nov): the read matches Pages as audience_sources does (`lib/retargeting/show-pages.ts` over `lineupSources` / `promoterPageIds`, access by `resolvePageAccess` with the client's linked Business Manager); lifetime-budget prospecting counts (`readProspecting`, GETs); Wider's lifetime is what the show's prospecting has left less Retargeting to its end, capped by the per-show ceiling (`showCeilingOf` over `resolveShowCeiling` / `spentToDate`); a tier with nothing to build hands its share to the next tier that has; every existing prospecting campaign is advised "pause when Wider goes live" (the pause is Matas's yes, never automatic); with no optimising pixel the event's, the venue's or the ad account's one active pixel is used; and for plan_retargeting and create_show_campaigns only (`connector`), the purchase read's not-proposed states don't skip a show. Since the 27 Nov plan: the plan line's split is the budgets as they are (Similar £0.00 and Cold holding its share when Similar is skipped); promoter Pages are only the show's own brand's (`lib/retargeting/show-brands.ts`: EBR → Electric Bristol, ES → Electric Studios, NX → NX, else the client's name; never every Page the client owns); and Louder / Parable is held (`HELD_CLIENTS` in `lib/retargeting/held.ts`, by client id; lifting it is deleting the row): plan_retargeting("live") leaves its shows out with a line at the top, and plan_retargeting on one of its shows and create_show_campaigns refuse. The 08:00 read doesn't read the hold. Local only: `MCP_DEV_TOKEN_STORE=memory` keeps the OAuth store in memory (refused on Vercel) and logs to stdout. Connector setup and revoking: `docs/mcp/README.md`, `scripts/mcp-revoke.mts`.

> **`REMOTION_AWS_ACCESS_KEY_ID`**, **`REMOTION_AWS_SECRET_ACCESS_KEY`**, **`REMOTION_AWS_REGION`**, **`REMOTION_LAMBDA_SERVE_URL`** — Caption renders run on Remotion Lambda in `eu-west-2` because the Vercel function image has no glibc 2.35, so `@remotion/compositor-linux-x64-gnu` does not start (verified 5 Nov 2026 on Node 22.x and 26.x). `scripts/remotion-lambda-deploy.mts` creates the bucket and the function and prints the serve URL; set `REMOTION_LAMBDA_SERVE_URL` from that output on Preview and Production. Keep a billing alarm on the AWS account — the June ceiling was $20, then $50 — so a render loop cannot run up a bill. See `docs/REMOTION_LAMBDA_SETUP.md`.

> **`BM_TOKEN_KEY`** (migration 145 — Business Manager Asset Sync) is the pgcrypto
> symmetric key for `client_business_managers.access_token_encrypted` (the
> operator's per-BM Facebook OAuth token). DEDICATED key — deliberately NOT
> `D2C_TOKEN_KEY` / `LANDING_PAGES_TOKEN_KEY` (blast-radius isolation). Passed into
> `set_bm_access_token` / `get_bm_access_token` RPCs, never stored. Without it,
> `POST /api/business-managers/connect` and the `bm-page-scan` cron fail fast. The
> BM tool acts EXCLUSIVELY as Matas's personal OAuth token (from
> `user_facebook_tokens`) — it never falls back to `META_ACCESS_TOKEN`. See
> `/business-managers` + `docs/session-logs/pr-pending-ops-business-manager-asset-sync.md`.

> **`FACEBOOK_OAUTH_SCOPES`** — optional comma-separated override for the Facebook OAuth dialog scope list (and the settings UI missing-permissions check); set on deployments whose Meta app cannot request `instagram_basic`. The default is `lib/meta/oauth-scopes.ts`: `pages_show_list, pages_read_engagement, ads_management, ads_read, instagram_basic, business_management, pages_manage_metadata` (M3c added the last, for `request_page_access`; "Manage Pages" use case, Standard access, so it is granted to people with a role on the Meta app). An override that leaves it out turns access requests off ("Reconnect Facebook in Off/Pixel to allow access requests.").

> **`META_VIDEO_UPLOAD_MODE`** — Storage-path video transport on
> `POST /api/meta/upload-asset`. Unset (the default) is multipart: the
> route downloads the object and posts it as `source`, today's path. Set
> to exactly `file_url` to sign the object for 30 minutes and let Meta
> download it. The default flips to `file_url` after one live Bournemouth
> upload is confirmed. When confirming, record: the `POST /act_{id}/advideos`
> status and JSON keys, and which field holds the video id; `GET /{id}?fields=status`
> timestamps until `video_status` is `ready`, including whether the first
> GET errors; and when `picture` stops being the encoding placeholder.
> Images always download. A wrong client SHA-256 only misses dedupe.

> **`TIKTOK_VIDEO_UPLOAD_MODE`** — TikTok Asset Library upload transport
> (`POST /api/tiktok/creative/upload`). Default `UPLOAD_BY_FILE` (multipart
> stream Vercel → TikTok). Set to `UPLOAD_BY_URL` to pass a short-lived
> Storage signed URL and let TikTok pull the file. Live measurement of
> 15/60/140 MB decides whether the default should change. Smart Fix stays
> off in both modes.

> **`OFFPIXEL_TIKTOK_WRITES_ENABLED`** — TikTok campaign launcher killswitch
> (`POST /api/tiktok/launch-campaign`). Must be exactly `"true"`; unset (the
> default) or any other value returns 503 and the Review & Launch button stays
> disabled. The launcher is `lib/tiktok/write/{campaign,adgroup,ad,orchestrator}.ts`
> plus all-at-once preflight in `lib/tiktok/write/preflight.ts`. Enhancements
> stay **off**: every ad is created with `is_aco: false` and
> `creative_authorized: false` (literal — the Review & Launch toggle is a
> fixed statement, not a switch). Smart+ (`draft.optimisation.smartPlusEnabled`)
> is a hard preflight blocker — this path never calls `/smart_plus/*` or Smart
> Creative endpoints. Campaign, ad groups, and ads are created **live**
> (`operation_status: ENABLE`) unless the operator chooses paused on Review
> (`launchPaused: true` → all three `DISABLE`). The remaining gates are the
> killswitch, preflight, and the Review confirmation — nothing else stands
> between the button and delivery. A failed launch deletes the TikTok
> campaign **and** clears `tiktok_write_idempotency` for that draft so retry
> cannot target deleted IDs. The flag has been `true` in production since
> 20 Aug 2026; the paused smoke test ran 21 Aug (campaign `1874142286754113`).
> `launchMode` (`attach_campaign` / `attach_adgroup` / `attach_all_adgroups`,
> `lib/tiktok/attach/`, `lib/tiktok/write/attach-orchestrator.ts`) launches
> into existing objects. Objective, CBO (`budget_optimize_on`) and the
> default pixel/event come from the target. A pre-existing campaign or ad
> group is never modified. A failed attach deletes only the ad groups and
> ads that run created.

> **Landing-page env vars** (PR 2 of the landing-page arc):
> `LANDING_PAGES_TOKEN_KEY` is the pgcrypto key for `event_signups` fan PII
> (deliberately NOT `D2C_TOKEN_KEY` — blast-radius isolation, see
> `docs/LANDING_PAGE_ARCHITECTURE.md` §8). `LANDING_PAGES_HASH_SALT` salts
> the dedupe hashes and is **effectively immutable** once live (rotating it
> breaks per-event dedupe). Cloudflare Turnstile keys are
> landing-page-specific; when unset the signup captcha check is skipped
> (dev mode) unless `LANDING_PAGES_TURNSTILE_REQUIRED=1` (set in prod).
> Rate-limit vars tune the signup limiter (defaults 5 signups / 10 min per
> IP+page).
>
> **PR 3 (Meta Pixel + CAPI):** `LANDING_PAGES_META_API_VERSION` sets the
> Graph API version for landing-page CAPI sends (default `v21.0`) —
> deliberately independent from `META_API_VERSION` (the ad-side client in
> `lib/meta/`); the LP arc never imports from `lib/meta/**`. Per-client
> pixel ids and CAPI tokens live on `client_landing_pages` (tokens
> encrypted; set via `set_landing_page_capi_token(client_id, token,
> LANDING_PAGES_TOKEN_KEY)`, decrypted only at send time). There is NO
> org-level pixel/token fallback by design — missing config = tracking
> off. `client_landing_pages.meta_test_event_code` routes a client's CAPI
> events to Meta's Test Events surface (QA only — clear after use). See
> `docs/LANDING_PAGE_ARCHITECTURE.md` §12.

> **`MAILCHIMP_WEBHOOK_SECRET`** secures the real-time Mailchimp tag webhook
> receiver (`POST /api/webhooks/mailchimp/{clientId}/{audienceId}`). The handler
> trusts a request if EITHER the `?secret=` query param equals this value
> (Mailchimp's URL-secret approach — append `?secret=…` to the configured webhook
> URL) OR an `x-mailchimp-signature` HMAC-SHA256 of the raw body matches. Without
> it, all webhook posts are rejected `401`. See the Mailchimp tag-tracking
> architecture note below for one-time webhook setup.
>
> **`CIRQLIN_PARTNER_READ_SECRET`** is the shared bearer the dashboard sends to
> Cirqlin `GET /api/partner/signups?tag=`. Same value Cirqlin compares
> timing-safe. Unset → the Cirqlin refresh/EOD leg reports `not_configured`
> and the Mailchimp leg still writes. **`CIRQLIN_API_BASE`** defaults to
> `https://app.cirqlin.com`. Join key is `events.mailchimp_tag` ↔ Cirqlin
> `pages.crm_base_tag`. Counts only — no PII.
>
> **`CIRQLIN_TO_DASHBOARD_BEARER`** is the shared bearer Cirqlin sends to
> `GET /api/community-aliases/{slug}` so crqln.com can resolve a repointable
> WhatsApp invite. Matas mints it (`openssl rand -hex 32`) and sets the same
> value on both Vercel projects. Neither Cursor nor Cowork holds it. The
> route compares the bearer with `timingSafeEqual` and never logs the value.
> Unset refuses every request (401). See `docs/community-aliases.md`.

> **`GOOGLE_DRIVE_EXPORT_DRIVE_ID`** — the Shared Drive "Off / Pixel"
> (`0AGzNNGLxNV_kUk9PVA`) that holds every client's and event's folder tree
> (`lib/drive/tree.ts`, S18 of `docs/design-record/2026-11-09-creative-lab-clip-selection.html`).
> The export runs as the service account in `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`
> (`offpixel-sheets-reader@off-pixel-dashboard.iam.gserviceaccount.com`, a Content
> manager on the drive, scope `drive`, `supportsAllDrives` on every call). Content
> managers cannot delete permanently; the export never deletes. Unset → the
> `/api/cron/creative-lab-drive-tick` cron (every 5 min) returns 200 with
> `skippedReason`. The tick makes trees for clients and events created from
> 9 Nov 2026, renames on a rename or re-date, makes the on-sale `w/c {d Mon}`
> folder (payday-week Monday and a fortnight later, from `lib/creative-lab/payday.ts`),
> marks cancelled events, files approved round renders (`drive_status`, migration
> 218) and marks judged winners. Since 11 Nov 2026 (record `2026-11-11-creative-lab-drive-owner-type`)
> every filing stage (Teaser, Announcement, Presale live, Reminders, each w/c, 4 Show week)
> takes `{owner} / Videos | Statics`: the owner is the render's footage owner
> (`creative_lab_clips.owner`, migration 226) under the lineup name, or the client's name
> (`{Client} (promoter)` on a clash); the type is `creative_lab_renders.kind`. Owner and type
> folders are made on first filing (`lib/drive/owner.ts`, `ensureRouteFolder`); new cycles are
> made empty. `scripts/drive-owner-type-migrate.mts` maps P26-BDAY's hand-made
> `w/c 9 Nov / Content / {owner} / Videos | Statics` folders in place (the client holds the
> Content link), so that cycle's filings land inside it; it never moves anything. Launch reads Storage, never Drive. Older events:
> `scripts/backfill-drive-tree.mts` (dry-run by default, `--apply`, `--event CODE`).
> Drive → app is `/api/cron/creative-lab-drive-pickup` (every 15 min, `lib/drive/pickup.ts`):
> the drive's changes feed from the token in `drive_change_cursors` (migration 219). New
> clips in `02 Source / Artist clips / {artist}` (named exactly as the Lab lineup,
> `event_artists.source = 'lab'`) go through the folder import as that artist's clip on
> the event; new files in `01 Open files` / `_Brand kit` become `drive_kit_audit_files`
> rows; the export's own files (appProperties tag) are skipped. Share with promoter is
> `lib/actions/drive-share.ts` (`shareEventFolder` / `stopSharingEventFolder`): one view
> permission on the event folder, never automatic.

> **`GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`** and **`GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY`**
> are **not required for the Asset Queue** (as of `cc/asset-queue-public-sheet-fetch`). The scrape
> route now reads sheets via the public CSV export endpoint — no service account needed. The env
> vars are retained here in case they are needed for a future feature; leave them unset on Vercel
> unless you have a specific use case.

> **Dropbox credentials (asset queue folder listing):** Three env vars are required:
> - `DROPBOX_REFRESH_TOKEN` — long-lived OAuth refresh token; never expires unless
>   explicitly revoked. Mint via OAuth offline flow with `token_access_type=offline`
>   (scopes: `sharing.read` + `files.metadata.read`). If the asset queue starts
>   returning `forbidden` errors after a long idle period, regenerate this token.
> - `DROPBOX_APP_KEY` — public client_id for the Off Pixel DB Dropbox app. Safe to log.
> - `DROPBOX_APP_SECRET` — client_secret. Never log.
>
> The integration auto-refreshes the short-lived access token using the refresh token
> before each Dropbox API call. Access tokens are cached in-memory with a 5-minute
> safety margin on the TTL (default 4h). Refresh tokens never expire. `DROPBOX_ACCESS_TOKEN`
> has been removed — do not set it anywhere.
>
> **`ENABLE_AI_AUTOTAG`** must be set to `"1"` in Vercel prod env vars for the
> AI creative auto-tagger to run inside the `refresh-active-creatives` cron.
> Without it the tagger silently skips (no error, no tags written). Requires
> `ANTHROPIC_API_KEY` to also be present. Check cron logs for
> `autotag_enabled=false` to confirm the env var state.

> **`ENABLE_MULTI_PLACEMENT_ASSETS`** must be set to `"1"` in Vercel prod env
> vars to activate **per-placement creative rendering**. When ON, a creative
> with both a Feed (4:5/1:1) and a vertical (9:16) asset of the same media kind
> is sent to Meta with `asset_feed_spec` + `asset_customization_rules` so Feed
> renders the 4:5 asset and Stories/Reels render the 9:16 asset (see
> `buildMultiPlacementCreative` in `lib/meta/creative.ts`). When unset/`"0"` the
> legacy single-asset path runs (one priority-chosen asset cross-published to all
> placements) — this is the safe rollback. Single-aspect and mixed-media (image +
> video) creatives always use the legacy path regardless of the flag. Applies to
> BOTH the standalone wizard launch and bulk-attach (shared `buildCreativePayload`).
>
> **Known limitation (pre-fix launches):** every launch before this fix shipped a
> single priority-chosen asset cross-published to all placements, regardless of
> how many aspect ratios were uploaded. Stories/Reels viewers saw Feed assets
> cropped to vertical. Already-running ads (e.g. Innervisions, J2 Melodic, Black
> Butter, Deep House Bible, 4thefans, BB26) keep serving cross-published creative
> until their next refresh/relaunch. Only NEW launches with the flag ON serve
> correct per-placement creative. Background + root-cause: see
> `docs/AUDIT_DUAL_PLACEMENT_ASSET_2026-06-05.md` (PR #560).

> **`ENABLE_META_THUMBNAIL_FETCH`** (default `"1"` when unset) gates the ONE
> place in the app allowed to call Meta's `/{video_id}/thumbnails` edge —
> `lib/meta/video-thumbnail-cache.ts`'s `fetchThumbnailUrl`. That endpoint was
> the #1 hit on the app's Meta rate-limit budget (1343 calls/24h): the
> `refresh-active-creatives` cron, the ad_id thumbnail proxy's video fallback,
> and the audience-builder video source picker each independently re-resolved
> the same `video_id`s on every run. `fetchThumbnailUrl` now checks the
> `creative-thumbnails` Storage bucket (migration 068e, `video-thumb/` prefix)
> first and only calls Meta on a genuine miss, deduped both cross-run (Storage)
> and same-run/concurrent (in-process in-flight map) — a given `video_id` can
> never trigger two Meta calls. Set to `"0"` to stop calling Meta entirely: a
> cache hit still serves, a miss returns `null` (callers already degrade to a
> placeholder) — use this as an emergency quota killswitch without touching
> other Meta-write flags. Every caller of the old raw endpoint (`lib/audiences/sources.ts`,
> `lib/reporting/active-creatives-fetch.ts` + `active-creatives-thumbnail-enrichment.ts`,
> `lib/meta/thumbnail-proxy-server.ts`) now routes through this helper; a
> regression-guard test (`lib/meta/__tests__/video-thumbnail-cache-guard.test.ts`)
> greps the tree to keep it that way.

> **`ENABLE_TIKTOK_THUMBNAIL_FETCH`** (default `"1"` when unset) gates the TikTok
> calls behind durable TikTok thumbnails (`lib/tiktok/thumbnail-cache.ts`).
> TikTok cover and image URLs are signed and expire about six hours after the
> read, so after the `tiktok-active-creatives` cron writes its snapshot rows it
> stores each ad's video cover (`/file/video/ad/info/`, 60 ids a call) or image
> (`/file/image/ad/info/`, 100 ids a call) in the `creative-thumbnails` bucket at
> `tiktok/video/{advertiser_id}/{video_id}.jpg` or `tiktok/image/{advertiser_id}/{image_id}.jpg`
> ("/" in an image id → "__"). Storage first, TikTok only on a miss, at most 20
> info calls per run, one call per id even when requested concurrently. Readers
> (`readActiveTikTokCreativesSnapshot`, the share report's TikTok grid) list
> Storage only and serve the object, else the snapshot URL while unexpired, else
> null. Set to `"0"` to stop TikTok calls and downloads; cache hits still serve.
> Spark ads that carry only `tiktok_item_id` take their cover from
> `GET /tt_video/list/` (`video_info.poster_url`), paged per identity after the
> video and image pass. Item ids that list does not contain are read with
> `GET /identity/video/info/` (doc 1738958351620097, up to 20 `item_ids` a
> call): `video_info.poster_url`, or the first carousel `image_url`. Each list
> page and each info call counts toward the same 20-call cap. The bytes are
> stored at `tiktok/item/{advertiser_id}/{tiktok_item_id}.jpg`. An identity
> whose post list or info read is unauthorised, or whose Spark auth has ended,
> is skipped. Readers serve that object for an item-only row, else null. Backfill: `scripts/backfill-tiktok-thumbnails.mts`
> (dry-run by default, `--apply` writes, `--client` or `--event-code`).

> **`OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED`** must be exactly `"true"`
> for signups to reach Meta as customer lists (SU1;
> `scratch/campaign-replicate/signups-to-meta.md`; `lib/customer-lists/`).
> Unset = `/api/cron/customer-list-sync` answers 200 with `skippedReason:
> "killswitch"` and `--run` runs as a dry run. A show is turned on only by
> `scripts/customer-list-sync.mts --event CODE --enable`, which writes its
> `customer_list_syncs` row (migration 267, service role only): the show's
> `{code} · Signups` list in the event's ad account (`events.meta_ad_account_id`,
> else the venue's; never the client's or a draft's). From presale day 08:00
> London (general sale with no presale) to show day, the list is made
> (subtype CUSTOM, USER_PROVIDED_ONLY) if no list of that name or
> registration exists, registered as `meta_custom_audiences`
> `list_role = 'signups'`, and kept current from CIRQLIN's
> `GET /api/partner/signups/hashed?crm_base_tag={events.mailchimp_tag}&scope=show&since=&limit=10000`
> (cirqlin #682): the first read (no cursor) is everyone who counts, paged
> while `has_more`; after that the cursor gives adds (`POST /{id}/users`)
> and removes (`DELETE /{id}/users`; withdrawn, deleted, flagged), 10,000 a
> batch, `[EMAIL_SHA256, PHONE_SHA256]` as CIRQLIN sends them (never
> re-hashed). The Monday 08:00 London run (or the first run 7 days after the
> last) fully replaces the list's users from a no-cursor read
> (`POST /{id}/usersreplace`, one session, `last_batch_flag` on the last
> batch; `last_replaced_at`): a GDPR erasure never shows in `removed`, so the
> replace drops it within 7 days. Only the show's own list is ever written:
> genre and high-value lists get nothing. Each run puts the list in every
> audience template of the client whose shows (`notes`, by code or show
> name) include it: one `customer_list` / `signups` item per show list,
> with its `meta_audience_id` (migration 267 adds `meta_audience_id` to
> 266's `audience_template_items_unique`, so every upsert on that key names
> it). `scope=promoter` is kept in the client and read by
> nothing. The row's cursor moves only once a page (or the whole replace) is
> on Meta, so a retry resends (Meta lists are sets; a hand upload first is
> safe). A failed CIRQLIN read leaves rows and lists as they were; an
> unknown tag (404) reads `not_linked` and writes nothing. Every write is on
> `meta_write_idempotency` (`customer_list_create`, `customer_list_users`
> with key op add / remove / replace, keyed on the event's oldest draft)
> with `{ required: true }`. Hashes live in memory only: rows, logs and
> errors carry counts. Archived clients are out. `--dry-run` (default) reads
> only (CIRQLIN, Meta GETs, templates) and prints the list, pages, CIRQLIN's
> counts and the template items; `--proposed FILE` matches templates #1363
> proposes too; `--run` does one sync now.
>
> **`CIRQLIN_PARTNER_HASHES_SECRET`** is the bearer for CIRQLIN's hashed
> signups read (`GET /api/partner/signups/hashed`, cirqlin #682), used only
> by `lib/customer-lists/cirqlin-hashed.ts`. A dedicated secret, not
> `CIRQLIN_PARTNER_READ_SECRET` (the counts-only read). Set on Vercel.
> Unset → every read is `not_configured` and nothing is sent. Never logged.

> **`OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED`** must be exactly `"true"`
> to POST a custom audience onto a live ad set from the Published library
> (`lib/meta/adset-targeting-write.ts`). Unset or any other value leaves
> the control visible and disabled, and the apply route returns 403 with
> no Graph POST. The write is a read of the whole `targeting` object, a
> change to `custom_audiences` or `excluded_custom_audiences` only, then a
> write-back. It is recorded on `meta_write_idempotency` as
> `adset_targeting_update` (migration 179). It is not an optimisation
> budget/pause write and it does not run through the launch route.

> **`OFFPIXEL_META_TREE_ADD_WRITES_ENABLED`** must be exactly `"true"` for
> "Add creatives to…" from the event's campaign tree (bulk-attach with
> `tree`). Unset or anything else returns 403 before any Meta call, and the
> sheet's button stays off. The bulk-attach page doesn't read it.

> **`ENABLE_OPTIMISATION_AUTOMATION`** (task #120) must be set to `"1"` in
> Vercel prod env vars to activate `/api/cron/optimisation-tick` (every 4h).
> Unset/anything else = fully disabled, the route responds 200 with
> `skippedReason: "killswitch"` rather than a cron failure.
>
> **`ENABLE_OPTIMISATION_WRITES`** (task #120, PR B) is a *separate* switch
> for real Meta `daily_budget` writes. Must be exactly `"1"`. A write
> happens only when all three gates are open (`optimisationDryRunGates` in
> `lib/optimisation/gates.ts`, same shape as D2C `shouldD2CDryRun`):
>   a) `ENABLE_OPTIMISATION_WRITES === "1"`
>   b) `campaign_drafts.optimisation_automation_enabled = true`
>   c) `campaign_drafts.optimisation_automation_live = true` (migration 154,
>      default false — set via SQL until PR C ships the UI toggle)
> Anything less → shadow insert (`dry_run=true`, `applied=false`), identical
> to PR A. A Meta pause write needs those three PLUS
> `ENABLE_OPTIMISATION_PAUSE_WRITES === "1"` (leave unset — shipping it
> off is the point). Fourth gate closed = today's recommend-only path
> (shadow row + `ads_urgent`). Fourth gate open still reduces to
> `pauseFloorBudget` first and only pauses at the floor, never the last
> active ad set, never more than two pauses per run, and never below
> `MIN_PAUSE_CONVERSION_RESULT_COUNT` (15). Never auto-resume.
> Decision logic still lives only in `lib/optimisation/evaluate.ts`;
> `lib/optimisation/apply.ts` executes the result. See
> `docs/session-logs/pr-929-optimisation-auto-pause.md`.

> **Slack notification service env vars** (task #121, Phase 1 + 2 — first
> proactive alerting the app has ever had):
> - `ENABLE_SLACK_NOTIFICATIONS` — master killswitch for `lib/notify/slack.ts`'s
>   `notify()`. Must be exactly `"1"`; unset (the default) or any other value
>   means every `notify()` call returns `{sent: false, reason: "killswitch_off"}`
>   without posting anywhere. Independent of any calling cron's own killswitch
>   (e.g. `ENABLE_BUDGET_PACING_ALERTS` below) — both must be on for a real
>   Slack message.
> - `SLACK_CHANNEL_ADS_OPS_ENABLED` / `SLACK_CHANNEL_ADS_URGENT_ENABLED` /
>   `SLACK_CHANNEL_ADS_AUTOMATION_ENABLED` — per-channel override, default
>   enabled (unset = on). Set to `"0"` or `"false"` to silence one channel
>   without touching the master switch above.
> - `SLACK_WEBHOOK_ADS_OPS` / `SLACK_WEBHOOK_ADS_URGENT` /
>   `SLACK_WEBHOOK_ADS_AUTOMATION` — the incoming-webhook URL Slack gives you
>   per channel (Slack App → Incoming Webhooks). Missing webhook for the
>   channel a caller targets = `{sent: false, reason: "no_webhook_configured"}`,
>   logged as an error (not a silent drop). Webhooks only for MVP — no Slack
>   OAuth/interactive components yet.
> - Business hours (10:00–20:00 Mon–Fri `Europe/London`, `lib/notify/business-hours.ts`)
>   gate `ads_ops`/`ads_automation` by default; `ads_urgent` always fires
>   regardless of the time of day. Every `notify()` call can override this
>   per-call via `respectBusinessHours`.
> - Dedupe/mute state lives in `notification_dedupe_state` (migration 152) —
>   see `lib/db/notification-dedupe.ts`. A caller-chosen `dedupeKey` +
>   `dedupeWindowMs` decides whether a repeat alert re-fires; a `muted` row
>   always skips regardless of the window. The click-through UI to flip
>   `muted` is a later phase — for now, flip it directly in Supabase.

> **`ENABLE_BUDGET_PACING_ALERTS`** (task #121 Phase 2) must be set to `"1"`
> in Vercel prod env vars to activate `/api/cron/budget-pacing-check` (hourly).
> Unset/anything else = fully disabled, the route responds 200 with
> `skippedReason: "killswitch"` rather than a cron failure. Evaluates every
> `status = 'published'` campaign's lifetime Meta spend against its planned
> budget (the SUM of its enabled ad sets' daily budgets × scheduled days —
> see `lib/budget-pacing/plan.ts`'s doc comment for why that, and not
> `budgetSchedule.budgetAmount`, is the correct denominator) and posts an
> `ads_ops` Slack message the first time each of 25/50/60/70/80/90/100% is
> crossed. Each threshold fires at most once per campaign ever
> (`dedupeWindowMs: Number.MAX_SAFE_INTEGER`) so a campaign that dips back
> below a threshold and crosses it again later does not re-alert. Zero Meta
> write calls.

> **`ENABLE_AD_DAILY_INSIGHTS`** (learning loop A) must be exactly `"1"` to
> activate `/api/cron/ad-daily-insights` (02:30 UTC). Unset = 200 with
> `skippedReason: "killswitch"`. Restates the last three complete UTC days of
> `GET /act_{id}/insights` (`level=ad`, `time_increment=1`, spend > 0) into
> `ad_daily_insights` (migration 185) for the union of `clients`/`events`
> `meta_ad_account_id` and `launched_ad_sets.ad_account_id`. Read-only
> against Meta, one attempt per call, call count logged per run
> (`meta_calls=`); a rate-limited or auth-failed account is skipped and
> reported. Each row also carries the insights `objective` (as
> `campaign_objective`) and `optimization_goal`, plus `promoted_event`, the ad
> set's `promoted_object.custom_event_type` (migration 187). That event is read
> only for sales conversion ad sets, whose insights row says
> `OFFSITE_CONVERSIONS` for Complete Registration and Purchase alike. The read
> is one batched `GET /?ids=…` per ≤50 ad sets not already known in the run or
> on the table, and it is counted in `meta_calls`. An unresolved field is left
> out of the upsert (batches are split by key set), so a stored value is never
> overwritten with NULL. Logic:
> `lib/ad-daily-insights/`. History backfill:
> `scripts/backfill-ad-daily-insights.mts` (dry-run by default). Objective
> backfill for older rows: `scripts/backfill-insights-objective.mts`
> (dry-run by default, `--fetch` reads only, `--apply` writes). Campaign grain
> is a SUM over `ad_daily_insights`.
>
> **`ENABLE_AD_COPY_CAPTURE`** must be exactly `"1"` to read ad copy inside
> that same cron. Unset leaves the insights run unchanged and makes no
> creative call. For each ad the run saw that has no `ad_copy` row, or a
> row older than 30 days, it batches the ad's creative (body, title,
> object story, every asset_feed_spec variant, effective_object_story_id,
> call to action) at 50 ids a call and counts those calls in `meta_calls`.
> A rate-limited account is skipped and reported. Snapshots and drafts
> fill an ad Graph did not return, and never replace a `graph` row.
> Read-only against Meta. Migration 206 is service-role only. Backfill:
> `scripts/backfill-ad-copy.mts` (dry-run by default, `--apply` writes,
> `--account` scopes it). Lab launch does not write copy yet.

> **`ENABLE_LEARNING_REFRESH`** (learning loop B) must be exactly `"1"` to
> activate `/api/cron/learning-refresh` (03:30 UTC, after ad-daily-insights).
> Unset = 200 with `skippedReason: "killswitch"`. DB-only, zero Meta calls.
> Joins `ad_daily_insights` to client/event (`resolveAdContext`), stage
> (`phase_at_launch` → `meta_objective` (`phaseFromMetaObjective` over the
> ad-day's campaign objective, goal and promoted event: Complete Registration
> and leads → registration, every other known objective → ticket sale) →
> event sale dates → `objective` (the majority of the ad's own result days)
> → `adset_objective` (the majority of the ad set's result days) →
> `unknown`; never campaign names) and tags
> (`creative_tag_assignments` by `meta_ad_id`, else event + ad name), then
> runs seven independent jobs: `creative_scores`, `tag_performance`
> (migration 186; client → vertical → all shrinkage, `lib/learning/shrink.ts`),
> `artist_library`, `copy_performance` (migration 207; normalised ad copy, event-relative index, service-role only),
> `copy_features` (migration 213; the same library re-keyed from words to
> shape labels — opener, cta_kind, scarcity_kind, length_band,
> emoji_count_band, has_lineup_list, has_date, has_price, line_count_band,
> every value from a fixed list in `lib/learning/copy/features.ts`; same
> maths as 207, n = shows; read through `topCopyFeatures` in
> `lib/learning/cross-client/`, operator-only, and the public-surface guard
> covers the table),
> `client_funnel_benchmarks` (`learned`, never over `manually-overridden`)
> and `interest_clusters.live_evidence` (never `evidence`). Archived clients
> are excluded. Readers: `lib/learning/read.ts`. Check before enabling:
> `scripts/learning-refresh.mts --dry-run`.
>
> **`ENABLE_LEARNING_FINDINGS`** must be exactly `"1"` to activate
> `/api/cron/learning-findings` (04:15 UTC, its own cron, not a
> `LEARNING_JOBS` job): every ad set in a show test campaign gets TF2 + TF5
> on TF9's days 4 / 8 / 12, whether or not the app made it, as one
> operator-only `test_verdict` row in `learning_findings` (migration 264),
> skipping ad sets with a `creative_tests` row and archived clients
> (`lib/learning/findings/`, RP1). DB-only, never a Meta write; check with
> `scripts/learning-findings.mts --dry-run [--date YYYY-MM-DD] [--event CODE]`.
> Observed tests never read "Extended" / "Stopped" (design C1 / S4, 23 Nov): a
> `test_verdict`'s `verdict` is `one_variant`, `no_result_event`, `next_read`,
> `day8_no_call`, `ended_no_call`, `day4_no_call` or a TF2 state (`running`,
> `first_read_pending`, `meta_favours`, `ready_to_call`, `no_clear_winner`,
> `not_enough_variants`), never `extended` / `stopped`; this supersedes the key
> list in migration 264's column comment, and rows stored as `extended` read on
> into day 8 and are overwritten on the same key.
> The same run then writes `show_week` (each show's last complete Mon–Sun week
> against the one before, costs from `showBenchmark`, best/worst 3 ads ≥ £12, the
> biggest mover), `axis_rollup` (pairs by axis × stage × voice, curves by
> teaser → phase, test verdicts by test kind, at client / vertical / all, shrunk
> with `shrink.ts`, capped by shows) and `copy_rule` (`copy_features` as stored:
> promoter vs artist disagreeing, proven ≤ 0.85, ≥ 1.25 from ≥ 2 shows).
>
> **`ENABLE_LEARNING_DIGEST`** must be exactly `"1"` to activate
> `/api/cron/learning-digest` (`0 10 * * 1` UTC, 10:00 London in winter, 11:00 in
> summer): one `ads_ops` message through `notify()` (so also
> `ENABLE_SLACK_NOTIFICATIONS` and `SLACK_WEBHOOK_ADS_OPS`, business hours on),
> deduped `learning_digest:{iso_week}`, built from `learning_findings` in E8's
> order (3 strongest cross-client rollups at ok or above, one line per show,
> tests called, recommendations waiting). Off by default; `?dry=1` and the
> findings dry run print it without posting.
> The same run writes `variant_pair` rows: two ads of one ad set whose names
> differ on one axis (date, text, CTA, format, [AB-A]/[AB-B]), compared only on
> ≥ 3 overlapping delivery days in one `phaseOf()` phase with each arm ≥ £10,
> else "not compared" in the dry run (RP2). And `phase_curve` rows: a show's cost
> per stage result per phase (teaser → announced → presale → general sale, from
> `events.announcement_at` / `presale_at` / `general_sale_at` through `phaseOf()`:
> a mid-day boundary counts from the next London day for pairs and is left out of
> curves, days after the latest known boundary take its phase, days before the
> earliest with no `announcement_at` are unknown, and a show with no boundary is
> `no_phase_data`) with each phase's ratio to the teaser, null with no teaser
> (RP3, `lib/learning/findings/phase.ts`).
>
> Genre pools run in shadow (`docs/design-record/2026-11-16-genre-key.html`,
> GK1–GK8; `lib/learning/genre/`). `events.genre_family` (migration 253) is one
> family per show from a fixed list, or null for "Not set". The operator sets
> it on the event form, one event at a time, from a suggestion it is never
> pre-filled with. After the seven jobs, `genre_shadow` builds genre rows for
> `tag_performance`, `copy_performance` and `copy_features`, then runs the
> audit's shuffle control (100 shuffles a job, 40 s cap). A family's pool is
> on only at ≥ 5 shows across ≥ 2 clients and beating ≥ 90 % of shuffles. A
> genre row needs 3 shows to count. Genre rows are never written and no
> reader reads them. The status per job rides on `cron_runs.detail.genre`
> and shows only as the operator status line on `/admin/cron-health`.
> Separately, at every scope, a `tag_performance` row from fewer than 3 shows
> never reads `strong` (`capByShows`, GK7). Copy rows already need 4 shows
> for that.
>
> `artist_library` (`lib/learning/copy/artist-extraction.ts`, `artist-plan.ts`)
> is the one job that calls out, and only to Spotify (`SPOTIFY_CLIENT_ID` /
> `SPOTIFY_CLIENT_SECRET`; unset → every name that needed confirming stays
> unconfirmed and nothing is written for it). It reads the events whose
> `ad_copy` rows were written in the last 7 days, recovers artist names from
> the Lab lineup facts, the event's own ad copy (capitalised runs in ≥ 3 ads,
> not the venue / city / client / a date or ad word; "b2b", "& more",
> "friends", "residents" split or end a run) and campaign / ad-set names,
> confirms each on Spotify (an exact name is a yes — Spotify returns no
> follower counts, popularity or genres to this app, so there is no follower
> test; several exact names confirm the act with `spotify_id` null and the
> hits in `profile_jsonb.spotify_candidates` for the Lab to pick; "X & Y"
> unknown → X and Y; a one-word name needs a lineup list, a lineup verb, a
> campaign name or the event's own name before Spotify is asked; the copy's
> casing is kept unless it only shouts the name), and writes `artists` +
> `event_artists` with `source = lineup | ad_copy | campaign_name`
> (migration 212; Lab rows are `lab`). At most 100
> searches a night. It never changes a Lab-written row, a Spotify id already
> set, or an existing link; `saveLabLineup` still replaces an event's rows
> when the operator saves the Lab lineup. `copy_performance` reads the names
> the job is linking the same night, so a support act becomes `{artist}` in
> the template key. The normaliser already read `event_artists` for every
> event; the library was 5 names before this. Backfill for every event with
> copy: `scripts/backfill-artists.mts` (dry-run by default, `--apply` writes,
> `--event CODE`, `--assume-confirmed` for the ceiling without Spotify,
> `--json FILE`). It prints the templates before and after. Matas runs
> `--apply` after merge, with the Spotify credentials in `.env.local`.

> **`ENABLE_ONSALE_REFRESH`** must be exactly `"1"` to activate
> `/api/cron/onsale-refresh`, the on-sale refresh of
> `docs/design-record/2026-11-12-on-sale-refresh.html` (P1: shadow proposals
> only). Unset = 200 with `skippedReason: "killswitch"`. Mondays at 06:00
> UTC (`"0 6 * * 1"`, after the 03:30 UTC learning-refresh; 06:00 London in
> winter, 07:00 in summer): the cycle refresh on each payday cycle's Monday (the payday-week
> Monday and the Monday a fortnight after it, `paydayCycleMondays` in
> `lib/drive/tree.ts`) and the mid-cycle check on the Monday between, reading
> the last full Monday–Sunday week; from show week's Monday the refresh
> stops. `?shadow=YYYY-MM-DD` starts a shadow run by hand (data to the day
> before); `?event=CODE` narrows it. `?post=pending` (`"5 10 * * 1"`) posts
> the proposals the 06:00 run stored while `notify()` was outside business
> hours (`slack_posted_at` null), one post per proposal. One proposal per
> campaign (the campaign's name on the event; a rebuilt campaign under the
> same name is the same campaign, and an ad set is its name within the
> campaign, so a rebuild's copy carries the original's totals) with R2's
> lines — add creative from the cycle's Drive owner folders (matched
> against Lab launches only, `matchedBy: "lab_launch"`; hand uploads in Ads
> Manager aren't matched, and the panel says so), claim ready, pause
> creative (never on the mid-cycle check), bring back / missing default /
> drop an audience, a within-campaign budget move — each with its evidence
> snapshot, the write it would make and its 393-px wording (`narrow`),
> stored in `onsale_refresh_proposals` + `onsale_refresh_lines` (migration
> 232, owner read RLS) and posted to `ads_automation` through `notify()`
> (its own killswitch, channel switch and business hours). Every threshold
> is in `lib/onsale-refresh/phase-config.ts` (R8; the presale config is
> noted there, not switched on; a client cluster comes back on the
> event's client's own `live_evidence.perClient` entry only — `cprIndex`
> ≤ 0.83, cost-based, confidence ≥ ok — never the pooled index). On-sale
> events are `lib/onsale-refresh/on-sale.ts`'s `isOnSale`: not cancelled,
> the show still ahead, and `status = 'on_sale'` or `general_sale_at`
> passed; the loader and the event page's panel mount share it, so every
> event the refresh posts about shows the panel. The ads' attributed
> purchases are any show's on the same pixel, never this show's sales
> (12 Nov: 22 of Julian Fijma's 24 landed before its presale): they sit
> under the purchase line as "Attributed to these ads … any show on this
> pixel" and decide nothing. The purchase line itself is the per-event
> read of `docs/design-record/2026-11-13-per-event-purchases.html`
> (`lib/onsale-refresh/purchases.ts` the rules, `purchase-read.ts` the
> reads): the pixel is the one in `promoted_object.pixel_id` on the ad
> sets that spent in the 14 days to the window end (most spend wins; a
> second pixel at ≥ 10 % of the spend is named), never
> `clients.meta_pixel_id`, which is read for the mismatch line ("Ads
> optimise on pixel …2763 (NX Live Skiddle); the client's stored pixel is
> …4565. Counts use …2763.", once per event to Slack) and never written.
> A show's own domain is its signup URL's host when no other running or
> upcoming event uses it, or the custom domain behind its
> `crqln.com/l/{slug}` link (the CIRQLIN page's canonical link, one public
> GET); `crqln.com`, ticket sites and a shared host are never a show's
> own. The count is the pixel's Purchase events on that domain (`GET
> /{pixel}/stats`, `aggregation=host`): 15 or more in 14 days reads
> "Purchase campaign proposed", fewer "under 15", and none in the history
> while the pixel has purchases "nothing reaches". Meta returns 28 days of
> that breakdown, not the record's 90, so the history is 28
> (`purchaseHistoryDays`). States in order: no pixel, no page or ticket
> URL, ticket site only, no domain of its own, shared domain, nothing
> reaches, under the bar / proposed; a read that failed says "this show's
> purchases couldn't be read this run. The next run tries again.", never a
> zero, and its raw reason goes to the evidence (`inputs.purchases.notRead`)
> and the run log (`purchasesNotRead` in the cron run's detail), never the
> panel or Slack. HE1 is the read only: no Purchase campaign line, no
> cross-campaign move and no custom conversion is made. Reads every `ad_daily_insights` row,
> paged in (date, meta_ad_id) order and deduped, so the spend to date is
> the event's all-time spend (IC = `omni_initiated_checkout`, LPV = the column),
> `creative_scores` (convert axis), `interest_clusters.live_evidence`,
> `ticket_warnings`, `events.budget_marketing`, `client_ticketing_connections`
> and one Drive listing per cycle type folder. Meta is read for the
> purchase line only, with `META_ACCESS_TOKEN`, one attempt per call,
> counted in `metaCalls` (one batch per ≤ 50 delivering ad sets, one for
> the mismatched pixels' names, the domain breakdown once per pixel an
> own-domain show counts on); it is never written. Archived clients
> are excluded. Nothing is applied: Accept / Reject / Apply are P2. The panel
> is `components/dashboard/events/onsale-refresh-panel.tsx` (read-only,
> fetched through `GET /api/events/[id]/onsale-refresh`, mounted on the
> event page's overview tab under the Creative Lab card for `isOnSale`
> events that aren't brand campaigns, "Show week: the refresh has stopped."
> once show week starts; the latest proposal per campaign by window
> end, then creation; missing ticketing is said under Objective, never a
> blocker); the frames are
> `app/(dev)/frames/onsale/[id]` until the shared frames registry takes the
> OR series (OR1 the panel, OR2 / OR3 the Objective block for P26-BDAY and
> NX26-LOCKLEAD, OR4 every purchase-line state). Dry run on prod, reads only: `scripts/onsale-refresh.mts --event
> CODE --shadow YYYY-MM-DD`; `--apply` stores the shadow proposals;
> `--purchases` prints the per-event purchase table for every on-sale
> event (`--also CODE` adds a show that isn't on sale).

> **`ENABLE_RETARGETING_READ`** must be exactly `"1"` to activate
> `/api/cron/retargeting-read`, the Retargeting campaign's daily read
> (`docs/design-record/2026-11-17-retargeting-campaign.html`, PR A: RT1, RT2,
> RT4, RT8, RT9; `lib/retargeting/`). Unset = 200 with `skippedReason:
> "killswitch"`. vercel.json runs `"0 7,8 * * *"` and the read acts at 08:00
> London. For every on-sale show to its show day (it carries on through show
> week) it writes one `{code} · Retargeting` proposal (`run_kind
> retargeting`, migration 256) with the Create line or the sentence that
> replaces it: three tier ad sets (Bottom, Mid Bottom, Mid) with budgets on
> the ad sets, 10 % of current daily spend (10 · 15 · 20 % on offer), split
> 50 / 25 / 25 with a £1 floor per tier. Meta is read only (the purchase
> read, `/me/accounts` page roles, min_daily_budget). Apply is the Purchase
> create path with budgets on the ad sets (`lib/retargeting/apply.ts`):
> behind `ONSALE_REFRESH_APPLY_ENABLED`, the Live arm,
> `ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED` and
> `OFFPIXEL_META_AUDIENCE_WRITES_ENABLED`, every ad set created paused and
> switched on last, every write on `meta_write_idempotency`, a
> `launched_ad_sets` row per tier. RT9: a show that takes this campaign no
> longer gets the refresh's per-campaign Retargeting default; the on-sale
> panel shows one note. Lists uploaded with a role (Signups, Similar,
> Buyers) and a show are `meta_custom_audiences` rows (`customer_list`,
> `list_role`, migration 256).
> PR B (`docs/design-record/2026-11-17-retargeting-campaign-2.html`, RT11,
> RT13–RT16): each show's links come from CIRQLIN's
> `GET /api/partner/page-links?crm_base_tag={events.mailchimp_tag}`
> (`lib/cirqlin/page-links.ts`, the same partner bearer and base as the
> signups read; cirqlin#653), re-read at every 08:00 read. Every
> `landing_url` and ticket link is one "URL contains" rule, host to the end of
> the path as returned (`lib/retargeting/links.ts`). A show with no tag keeps
> RT2's two links (`ticket_url`, `signup_url`). A 404 `no_page` and any other
> failure are their own not-proposed sentences. A failed read keeps a running
> campaign's last rules. When the links change, the read rewrites the changed
> audiences' rules (`lib/retargeting/rule-rewrite.ts`: `POST /{audience} {rule}`)
> through the on-sale refresh Apply's token (the event owner's
> `agencyMetaToken`, then their own `user_facebook_tokens` token; never a
> client's) and its `graphPostWithToken`, on `meta_write_idempotency`
> (`retargeting_audience_rule_update`, migration 257), only behind the apply
> and audience-write gates and only for a campaign an accepted Create line
> built. A per-link audience that's new or gone is reported as a rebuild,
> never written. Checkout starters and registrations count on the links' rules only.
> Every source is built at RT14's windows, each its own audience, named
> "{code} · {source} · {n} days" (`lib/retargeting/audiences.ts`), with leave-outs
> over every window. Bottom gains CompleteRegistration on the landing pages
> (30, 90, 180 days). RT18 (`docs/design-record/2026-11-17-retargeting-campaign-3.html`): at its source's longest window
> each link is its own audience ("{code} · Ticket-link visitors · {name} · 30
> days", "{code} · Page visitors · {name} · 60 days"), so the row shows Meta's
> size band per link once created ("By link: known after create" before). The
> pixel's 28-day hosts (`GET /{pixel}/stats?aggregation=host`: every event,
> then PageView, InitiateCheckout, CompleteRegistration; Meta gives origins
> only, never paths) give "Pixel on {names}: yes · {names}: no" per
> third-party ticket platform (named by host) and per own domain, never for
> crqln.com or a landing host another show's pages use; RT15's
> no-registrations line and RT13's empty Bottom. Create starts at today's share (`lib/retargeting/shares.ts`:
> 10 %, 15 % payday or final month, 20 % final two weeks, 25 % final week; the
> 10 / 15 / 20 % choice is gone). RT16: Retargeting lines take
> `retargetingGates` (the deployment's apply gate with the arm Live), so the
> panel is Live on every show without arming; the rest of the refresh keeps
> R4's arm. Migration 257 lets a `retargeting_campaign` row in
> `onsale_refresh_audiences` carry its audience key as `part`.
> **Re-ruled 26 Nov to the funnel** (`docs/design-record/2026-11-26-retargeting-funnel.html`,
> RF1–RF9; `lib/retargeting/funnel*.ts`): Cold / Warm / Hot in Meta names, one
> window per source (RF2), each tier leaving out every tier to its right and
> buyers; the share of the show's daily spend by stretch, 25 % at announce to
> 50 % in the final week, with its split (RF3); the money taken from the show's
> prospecting budgets, largest first, never under £1.00 an ad set, taking what's
> there when short (RF4); a tier over frequency 3 capped at its 7-day spend a day
> (RF5); missing advertiser access said once (RF6). The panel's Accept and the
> connector's `create_show_campaigns` share one create path keyed on the event
> (`retargeting_builds`, migration 275, and the write ledger). RT2's tiers and
> split, RT4's money, RT11's shares, RT14's windows, RT18's per-link audiences and
> RT17's arm create are gone (no show was ever built on them); RD's not-proposed
> sentences, the purchase read and Accept / Reject stand.
>
> PR E (RT17, the layout test; `lib/retargeting/test.ts`, `apply.ts`
> `applyTestArms`, `apply-call.ts`): a show whose total is £6.00 a day or more
> gets two campaigns, "{code} · Retargeting · A/B · A" (RT14's tiers by action)
> and "· B" (J2's recency layout, `recencySpecs`), half the total each. Ops'
> option (c): under the one Accept both arms are made PAUSED with every ad
> set's `start_time` at the test's start (00:00 in the ad account's
> `timezone_name`, tomorrow there), then the Meta A/B test
> (`POST /{business_id}/ad_studies`, the two campaigns as 50 % cells, op kind
> `retargeting_study_create`), then everything is switched on; nothing can
> deliver before the split. If Meta refuses the test, Apply stops with all of
> it paused and says so (no fallback without Matas). The call is pooled across
> every show in the test (spend ÷ attributed purchases summed, from
> `ad_daily_insights` by the arm campaigns' names): made at 14 days, 30
> purchases per arm, 3 shows and 15 % cheaper; from 28 days under 15 %, "No
> clear winner…" keeps A. It's a `retargeting_test_call` line on every test
> show's panel; accepting once pauses the loser on every show, ends each test
> (`retargeting_study_end`) and gives the winner the show's whole total. New
> shows then build one campaign on the winner. Migration 259 adds the line kind
> and the two op kinds.

> **`ENABLE_GOOGLE_ADS_DAILY_INSIGHTS`** must be exactly `"1"` to activate
> `/api/cron/google-ads-daily-insights` (04:00 UTC). Unset = 200 with
> `skippedReason: "killswitch"`. Read-only against Google Ads (GAQL search,
> never a mutate). Restates the last three complete days, for every account a
> non-archived client or event links, into migration 192's
> `google_ads_daily_snapshots` (campaign × day, every channel type; VIDEO
> carries TrueView views, view rate and CPV in micros, SEARCH carries
> impression share), `google_ads_search_terms_snapshots` (`search_term_view`)
> and `google_ads_location_snapshots` (`geographic_view`: country and
> presence/interest). `plan_id` is matched on the campaign resource name
> (`google_search_campaigns.pushed_resource_name`, else
> `google_video_campaigns.google_campaign_resource_name`). `event_code` is the
> first `[CODE]` in the campaign name exactly as written, never uppercased. The
> event grain is still `event_daily_rollups.google_ads_*` from rollup-sync.
> An account whose event rollup shows Google spend on a day with no campaign
> rows is failed (`rollup_spend_without_campaign_rows`), the route returns
> 207, and the run's `google_ads_insights_runs` row shows as `failed` on
> `/admin/cron-health` with the account and days. The run also writes
> `google_ads_accounts.enabled_conversion_actions` (GOOGLE_HOSTED excluded);
> 0 shows a "running blind" badge on `/google-ads` plans. Calls per account
> per run: four (a window that fills a 10,000-row page is halved). Backfill:
> `scripts/backfill-google-ads-insights.mts` (dry-run fetches and writes
> nothing, `--apply` writes, `--since`/`--until`, `--show-locations CODE`).

> **`ENABLE_CREATIVE_TESTS_READ`** must be exactly `"1"` to activate
> `/api/cron/creative-tests-read` (`0 7,8 * * *` UTC; it acts on the run that is
> 08:00 London). Unset = 200 with `skippedReason: "killswitch"`. It writes one
> `creative_test_reads` row a London day for every running test in a
> `{code} · Tests` ad set. Under TF9 (`docs/design-record/2026-11-18-creative-testing-7.html`)
> the end day's read decides: on day 4 (then 8 and 12) TF6 calls, extends the
> ad set's `end_time` by 4 days that morning, or stops it by pausing it at that
> read. No write without a benchmark, none after 23:00 London, none before the
> 02:30 UTC ad-daily-insights restate has run that day; a missed end day falls
> to the next morning's read. Writes need **`CREATIVE_TESTS_READ_WRITES_ENABLED`**
> and **`CREATIVE_TESTS_CREATE_ENABLED`** both exactly `"true"` (the second also
> gates Approve, `POST /api/creative-lab/tests/[id]/approve`, 503 otherwise); a
> pause also needs **`OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED`** = `"true"`.
> With writes off the read row still lands with `pending: "writes off"` and the
> panel shows the decision. It only ever pauses, never resumes, and writes only
> to the test's own ad set (its `launched_ad_sets` row is `source_type =
> "creative_test"`), never a main campaign or the copy test. Each write is keyed
> in the Meta write ledger (`adset_end_time_update`, migration 263). Logic:
> `lib/creative-tests/read-job.ts`, `lib/meta/adset-end-time-write.ts`.

> **D2C orchestration env vars** (brief→campaign automation, PR #647):
> - `D2C_TOKEN_KEY` — pgcrypto symmetric key used to encrypt/decrypt D2C
>   provider credentials (`get_d2c_credentials` / `set_d2c_credentials`, migration
>   042). Required for any live D2C send; without it credential decryption fails.
>   Never log.
> - `D2C_BRIEF_PARSER_MODEL` — Anthropic model the brief PDF parser uses
>   (`lib/d2c/brief-parser/index.ts`). Defaults to `claude-opus-4-6` when unset.
> - `CREATIVE_LAB_WRITER_MODEL` — Anthropic model `generateCaptions` uses.
>   Defaults to `claude-opus-4-6` when unset.
> - `CREATIVE_LAB_LAUNCH_ENABLED` — Creative Lab round launch
>   (`POST /api/creative-lab/rounds/[id]/launch`). Must be exactly `"true"`.
>   Unset or any other value makes the route return 503 before any upload,
>   Graph call or database write, and the event-card button stays disabled
>   with "Lab launches are switched off". When it is on, every ad is still
>   created paused (`createPaused: true`). Set it on Vercel only after M3b
>   merges. This PR does not set it.
> - `CREATIVE_LAB_IG_AUTO_IMPORT` — nightly Instagram import
>   (`/api/cron/creative-lab-clip-sync`). Must be exactly `"1"`. Unset means
>   the cron only lists clips; the Add button works either way.
> - `BIRD_API_BASE` — base URL for the Bird.com API client
>   (`lib/d2c/bird/client.ts`). Defaults to `https://api.bird.com` when unset.
> - `FEATURE_D2C_LIVE` — master live-send gate. When unset/`false` (default) every
>   provider `send` short-circuits to a dry run regardless of per-client flags.
>   This is the first of the **3-of-3 live gates**: `FEATURE_D2C_LIVE` (env) AND
>   `d2c_connections.live_enabled` AND `d2c_connections.approved_by_matas` must all
>   be true for a real send (`shouldD2CDryRun` / `d2cDryRunGates` in
>   `lib/d2c/types.ts`, enforced by every provider and cron-side in
>   `/api/cron/d2c-send`).

### Database

Schema: `supabase/schema.sql`. Tables: `campaign_drafts`, `campaign_templates` (both with RLS per user).

**Latest migration:** `277_bm_tables_operator_read.sql` (the seven Business Manager tables, `client_business_managers`, `client_business_manager_links`, `bm_pages`, `bm_ig_accounts`, `bm_ad_accounts`, `bm_pixels`, `bm_page_access_events`, read by operators' sessions and the service role only: each SELECT policy is `using (not public.is_client_member())`, 251's test, so /admin client logins read nothing; unapplied). Held for the retargeting connector PR (#1399): `275_retargeting_builds.sql` (M3c, the retargeting funnel: `retargeting_builds`, one row per show's `{code} · Retargeting` build from the panel or `create_show_campaigns`, so a re-run resumes and a paused build counts as built; and `page_groups`, the Similar tier's genre page groups per client, unconfirmed until Matas confirms, service role only; written only by `lib/retargeting/funnel-apply.ts`, owner read RLS; no ledger op kind added. Unapplied — ops applies after the design PASS). Before it: `276_client_business_manager_links.sql` (one Business Manager linked to several clients: `client_business_manager_links`, one row per business and client, authenticated read, backfilled from `client_business_managers.client_id`; unapplied; 275 is held for the retargeting connector PR). Before it: `273_page_access_request.sql` (M3c: the `meta_write_idempotency` op-kind CHECK re-added with prod's 27 kinds plus `page_access_request`; unapplied, ops applies it after the design PASS). Before it: `272_client_parent.sql` (M3d-a, `clients.parent_client_id`; applied). Before it: `271_scheduled_meta_changes.sql` (MCP M3b: `scheduled_meta_changes`, one row per budget change asked for a later time with its chat yes, service role only like 268; five `meta_write_idempotency` op kinds for the connector's live writes, `campaign_status_update`, `adset_budget_update`, `campaign_budget_update`, `object_name_update`, `ad_study_create`, the CHECK re-added with prod's 22 plus these. Applied). Also applied 26 Nov, after 271: `259_retargeting_test.sql` (RT17, #1321, the layout test: the `onsale_refresh_lines` line kind `retargeting_test_call`, and the ledger CHECK re-added with the same 27 kinds as 271, so neither drops the other's). Before it: `270_render_packages.sql` (M4a, records `2026-11-25-m4-render-templates` as re-ruled by `2026-11-25-m4-renders-on-yes`: `creative_lab_render_packages` (one per Render press or `render_package` call on Matas's yes; a partial unique index keeps one package rendering per event), `creative_lab_renders` gains `recipe`, `package_id`, `file_name`, `variant`, `round_no`, `owner_kind`, `rights_shareable` / `rights_held_reason`, `checks`, `storage_path`, `library_shortcut_id` with `clip_id` / `caption_id` nullable for package files only (a CHECK keeps caption renders as they were), `creative_lab_audio_files.beat_grid`, and `mcp_actions.kind` gains `render`. Code: `lib/render-templates/` (plan, checks, rights, file names, worker on the render tick), `render_package` / `get_render_package` (scope `mcp:render`, MATAS_USER_IDS only). Applied 25 Nov). Before it: `269_artist_assets.sql` (the artist library, record `2026-11-25-artist-library`, AL1 AL2 AL5: `artist_assets` (one row per clip, static, render, caption or ad held for an artist, `owner_kind` artist | promoter | offpixel; a CHECK forbids a shareable promoter row; a render is shareable only when every clip in it is artist-owned) and `artist_library_folders` (the `00 Artist Library / {artist} /` folder map the Drive tick fills; Share with promoter refuses every folder in it); service role only. Filled by `scripts/artist-library-backfill.mts` (dry run by default) and the Drive pickup; read by the MCP's `get_artist`. Applied 25 Nov). Before it: `268_mcp_actions.sql` (Off/Pixel MCP M1: `mcp_actions` (the action log; kind read | draft | meta, status requested | approved | rejected | done | failed, approval_source claude_prompt | today), `client_spend_ceilings` (unused until M3), and the OAuth store `mcp_oauth_clients` / `mcp_oauth_grants` / `mcp_oauth_codes` / `mcp_oauth_tokens`, codes and tokens as SHA-256 only; service role only, RLS on with no policy. Applied 24 Nov). Before it: `267_customer_list_syncs.sql` (SU1 signups into Meta: `customer_list_syncs`, show lists only, with `last_replaced_at` / `last_replace_count` for the weekly replace, service role only; ledger op kinds `customer_list_create` and `customer_list_users`, the CHECK re-added with the 22 kinds live on prod (pg_constraint, 24 Nov, after 257 was applied); `audience_template_items_unique` rebuilt with `meta_audience_id` as its eighth column, so a template holds one item per show signups list. Applied 24 Nov). Before it: `266_campaign_creator_replicate.sql` (R1/R2/R6/R7 of the campaign creator update, record `2026-11-24-campaign-creator-replicate`: `venues.client_id` / `meta_ad_account_id` / `meta_pixel_id`, `events.meta_pixel_id` (event override), `audience_templates` + `audience_template_items` (unique nulls-not-distinct per role), `campaign_additions` (the R7 log); owner RLS + 251's client-member guard. Venue values come only from `scripts/seed-venue-meta-defaults.mts`. `lib/replicate/replicate.ts` `replicateDraft` re-derives event, code, name, account (event, then venue), pixel (event, then venue), links, dates and audiences by role from the target; `lib/actions/replicate-to-event.ts` saves the draft, never launches). Applied 24 Nov. Before it: `265_ad_library.sql` (applied 24 Nov); then `264_learning_findings.sql` (`learning_findings`, the learnings engine's store: kinds `test_verdict` · `variant_pair` · `phase_curve` · `axis_rollup` · `show_week` · `copy_rule`, unique nulls-not-distinct on (kind, scope, scope_id, stage, week_start, subject), `source`, `read_day`; service role only like 213, the app reader gates on `OPERATOR_USER_IDS`). Applied 23 Nov. Before it: `263_creative_tests_read_ledger.sql` (Meta write-ledger op `adset_end_time_update` for the creative-tests read job; applied 18 Nov). Before that: `261_creative_tests_variant_pair_kind.sql` (`creative_tests.kind` `pair`, the `stopped` state, `extensions` / `extension_evidence`, `creative_test_reads.benchmark_cost` / `benchmark_spend` / `benchmark_results`; applied 18 Nov). Earlier note: `200_creative_lab_m3.sql` (caption styles widened, `primary_text`, `declared_names`, `size_variant`, `creative_lab_style_settings`, round target columns, `round_ads.launch_state` / `render_id`, `renders.attempt`, `creative_lab_event_facts.headliners`; `clips.event_id` is the show the clip was filmed at). Unapplied — Matas applies. Before it: `199_creative_lab_video_safe_rect.sql` (`creative_lab_renders.kind` `video`|`static`, default `video`; comment on `creative_lab_clips.crop_focus_y` is now the vertical centre of the 4:5 safe rectangle inside the 9:16 frame). Before it: `198_creative_lab_crop_focus.sql` (`creative_lab_clips.crop_focus_y`). Unapplied — Matas applies. Before that: `197_creative_lab.sql` (Creative Lab M1: `creative_lab_artists`, `creative_lab_event_facts`, `creative_lab_clips`, `creative_lab_captions`, `creative_lab_rounds`, `creative_lab_round_ads`, `creative_lab_round_ad_launches`, `creative_lab_renders`; owner-only RLS via `user_id`; widens the `creative_tags` dimension/source CHECKs and the `creative_tag_assignments` source CHECK for `caption_style` / `creative_lab`; applied). Before that: `194`–`196` (MML copy, cron runs, client season reports), then `193_mml_creative_intake.sql` (`campaign_plan_intake_assets`, `campaign_plan_creative_groups`, `campaign_plan_creative_group_members`; owner-only RLS, cascade from `campaign_plans`). Before that: `192_google_ads_campaign_insights.sql` (`google_ads_daily_snapshots`, `google_ads_search_terms_snapshots`, `google_ads_location_snapshots`, the `google_ads_insights_runs` run log, and `google_ads_accounts.enabled_conversion_actions`; owner-only read RLS, service-role writes). Unapplied — Matas applies. Before it: `191_google_video_responsive_ads.sql` (`google_video_plans.business_name`, `google_video_ads.extra_copy` for copy slots 2..5; applied to prod). Before that: `190_google_video_plans.sql` (YouTube video plans: `google_video_plans` / `campaigns` / `ad_groups` / `placements` / `ads`, owner-only RLS, no push columns; applied to prod 2026-10-08). Before that: `188`/`189` (Google Search plan budgets, CPC caps, ad-group negatives, canvas total budget), then `187_ad_daily_insights_objective.sql` (`campaign_objective`, `optimization_goal`, `promoted_event` on `ad_daily_insights`). Before it: `186_tag_performance.sql` (learning loop B: `tag_performance` + `interest_clusters.live_evidence`), then `185_ad_daily_insights.sql` (per-ad per-day Meta insights) with `184_launched_ads.sql` (one row per Meta ad the app creates, written by `lib/launched-ads/`). Unapplied — Matas applies. Join an ad to client/event with `resolveAdContext` (`lib/learning/ad-facts.ts`). Earlier: `179_meta_write_idempotency_adset_targeting.sql` (`adset_targeting_update` on the Meta write ledger). Prior numbered note: `168_campaign_plan_benchmarks_v.sql` (166 predictions, 167 `events.venue_key`, 168 benchmark view). 168 windows: signup/click/lpv/lead before general sale; purchase on or after; ticket through last ticket day; view whole run (`meta_reach` ÷ 1000). TikTok click → `tiktok_clicks` only.

- Optimisation automation live flag (task #120 PR B, August 2026):
  `campaign_drafts.optimisation_automation_live` (migration 154) — default
  false. Third leg of the write gate alongside `ENABLE_OPTIMISATION_WRITES`
  and `optimisation_automation_enabled`. Armed from Step 2 / Review via the
  Off / Shadow / Live control (task #120 PR C).

- Slack notifications (task #121 Phase 1, August 2026): `notification_dedupe_state`
  (migration 152) — dedupe/mute state for `lib/notify/slack.ts`'s `notify()`,
  keyed by a caller-defined `dedupe_key` (e.g. `budget_threshold:<campaignId>:<threshold>`
  from Phase 2's budget-pacing cron). `data` jsonb holds the last fired
  payload for debugging; `muted`/`muted_at` support a future "mute this
  alert" click-through not yet built.

- Client admin dashboard (July 2026, OP909 arc): `client_users` maps one
  auth user → one client (the /admin authorisation pivot; `role` =
  `'owner'` only for MVP). Additive SELECT-only RLS policies grant client
  members read access to their own `clients` / `events` / `page_events` /
  `client_landing_pages` / `event_signups` rows; admin writes are
  service-role server actions gated by `requireClientContext()`.
  Also: `client_landing_pages.brand_instagram_url_default` /
  `brand_tiktok_url_default`, `event_signups.deleted_at` (soft delete),
  and the `landing-page-assets` storage bucket (public read).
  See `docs/ADMIN_DASHBOARD_ARCHITECTURE.md`.

- Landing pages Supreme UX (July 2026, LP PR 6): `event_signups` DROPPED
  `first_name`/`last_name`/`city` and gained `geo_country`/`geo_region`/
  `geo_city` (server-derived from Vercel geo headers, never from the form
  body). `client_landing_pages` gained presentation + consent config
  (`privacy_policy_url`, `logo_style` box_logo/wordmark, `box_logo_text`,
  `show_off_pixel_attribution`, `partner_consent_enabled`, `partner_name`,
  `partner_privacy_policy_url`). `page_events` (NOT `events` — LP
  presentation stays on the LP-owned table) gained `artwork_palette`
  (server-extracted via sharp, lazy at render time), `hero_images`,
  `countdown_target_at`/`countdown_label`, `youtube_url`, `bottom_images`.
  See `docs/LANDING_PAGE_ARCHITECTURE.md` §15.

Notable recently-added tables / columns (dashboard-era, April 2026):

- `event_daily_rollups` — per-event per-day spend + tickets rollup,
  with three separate spend columns:
  - `ad_spend` (raw Meta total, including presale)
  - `ad_spend_allocated` (non-presale, post-opponent-attribution split)
  - `ad_spend_presale` (presale-only, split evenly across events at
    the same venue)
  Also: `meta_regs` (on-meta conversions used for presale bucket).
- `additional_spend_entries` — per-event ad-hoc spend rows (e.g.
  influencer fees, OOH boards) that add into the total-marketing
  calculation without touching `event_ad_plans.budget_paid_media`.
- `ticket_sales_snapshots.source` — distinguishes `eventbrite`,
  `manual`, `xlsx_import`, `foursomething`. Priority resolution
  (manual > xlsx_import > eventbrite) lives in
  `lib/db/event-history-collapse.ts`.
- `client_ticketing_connections.provider` — CHECK-constrained to
  `eventbrite` / `fourthefans` / `manual` / `foursomething_internal`.
  Manual + foursomething_internal are null-provider implementations
  (see `lib/ticketing/manual/provider.ts`).
- `events.total_marketing_budget` was DROPPED in 051 — the total is
  computed live from plan paid media + additional spend entries.
- Funnel rates: `client_funnel_benchmarks` (migration 158) is the live
  store. `event_funnel_overrides` (migration 060) was never read by a
  shell. Migration 209 drops it, and drops `campaign_daily_insights`,
  which `ad_daily_insights` (migration 185) replaced.
- TikTok pipeline (April 2026): `tiktok_accounts` (encrypted credentials,
  migration 054), `tiktok_active_creatives_snapshots` (057),
  `tiktok_campaign_drafts` + `tiktok_campaign_templates` (058),
  `tiktok_rollup_breakdowns` (059), `tiktok_write_idempotency` (062). Full
  integration including OAuth, rollup, share, breakdowns, wizard, library,
  brief export, and the write launcher (`POST /api/tiktok/launch-campaign`,
  gated by `OFFPIXEL_TIKTOK_WRITES_ENABLED`, enhancements off by default).
- Google Ads pipeline (April 2026): `google_ads_accounts` (encrypted
  credentials, migration 063; customer_id uniqueness constraint 065),
  `event_daily_rollups` extended with Google Ads columns (064). Includes
  YouTube via Video campaign subtype. MCC 333-703-8088, Basic Access,
  15k ops/day.
- Creative tagging foundation (April 2026): `creative_tags` +
  `creative_tag_assignments` + `creative_scores` (migration 061).
  Motion-replacement Phase 1 schema; Phase 2 AI tagging unblocks once tags
  seed.
- Meta awareness rollup (April 2026): `event_daily_rollups` extended with
  `meta_impressions`, `meta_reach`, `meta_video_plays_3s` /
  `meta_video_plays_15s` / `meta_video_plays_p100`, `meta_engagements`
  (migration 066). Powers brand-campaign Daily Trend chart cross-platform
  read and the BB26-KAYODE awareness reporting template.
- Snapshot cache auto-invalidation: `build_version` column on
  `active_creatives_snapshots` and `share_insight_snapshots` (migration
  067) stamped with `VERCEL_GIT_COMMIT_SHA`; readers treat mismatched/NULL
  as stale across deploys.
- D2C comms (April 2026, encryption June 2026): `d2c_connections` stores
  per-client provider credentials. Migration 042 added `credentials_encrypted`
  (pgcrypto blob; raw `credentials` deprecated), `live_enabled`, and
  `approved_by_matas` — the per-client legs of the 3-of-3 live-send gate.
  `d2c_scheduled_sends` holds queued/sent messages with `dry_run`,
  `approval_status`, `approved_by`/`approved_at`.
- D2C orchestration (June 2026, PR #647): `d2c_event_copy` (migration 126) —
  one row per event holding resolved `artwork_url`, pasted
  `whatsapp_community_url`, and a `copy_jsonb` bundle of per-milestone rendered
  copy. `d2c_scheduled_sends` extended with `job_type` (one of `announce`,
  `reminder`, `community_early`, `presale_live`, `gen_sale`, `autoresp_setup`)
  and `idempotency_key` (`${event_id}:${job_type}`, full unique index so the
  brief processor upserts without duplicating sends). `d2c_brief_ingest_jobs`
  (migration 127) tracks PDF/manual brief → campaign ingestion
  (`pending`/`processing`/`succeeded`/`failed`, `result_event_id`).

### Crons

`vercel.json` registers the scheduled jobs under `app/api/cron/*`. Notable:

- `/api/cron/d2c-send` — drives the D2C brief→campaign automation. Reads due
  `d2c_scheduled_sends` rows (now carrying a `job_type`), hydrates
  `whatsapp_community_url` + `artwork_url` from `d2c_event_copy`, and dispatches
  each of the 6 milestone job types (`announce`, `reminder`, `community_early`,
  `presale_live`, `gen_sale`, `autoresp_setup`) through the Mailchimp/Bird
  providers. Live sends require the 3-of-3 gate (see env vars above); otherwise
  every send is logged as a dry run.
- `/api/cron/cron-health-check` — silent-failure monitor (migration 124),
  surfaced at `/admin/cron-health`.
- `/api/cron/optimisation-tick` (every 4h) — task #120, Step 6
  "Optimisation Strategy" automation loop. Evaluates opted-in published
  campaigns via `evaluate.ts` and, when the three-of-three write gate is
  open (`ENABLE_OPTIMISATION_WRITES` + enabled + live), applies
  `scale_up`/`scale_down` to Meta. Pause writes need a fourth gate
  (`ENABLE_OPTIMISATION_PAUSE_WRITES`) and stay off until that is set.
  See `ENABLE_OPTIMISATION_AUTOMATION` / `ENABLE_OPTIMISATION_WRITES` above.
- `/api/cron/budget-pacing-check` (hourly) — task #121 Phase 2, the first
  consumer of the Phase 1 Slack service. Evaluates every published
  campaign's lifetime Meta spend against its planned budget and posts an
  `ads_ops` Slack alert on each 25/50/60/70/80/90/100% threshold crossed
  (see `ENABLE_BUDGET_PACING_ALERTS` above). Zero Meta writes.
- `/api/cron/ad-daily-insights` (02:30 UTC) — learning loop A. Per-ad
  per-day insights into `ad_daily_insights` (see `ENABLE_AD_DAILY_INSIGHTS`
  above). Zero Meta writes.
- `/api/cron/learning-refresh` (03:30 UTC) — learning loop B. Stored
  learnings with n and confidence (see `ENABLE_LEARNING_REFRESH` above).
  Zero Meta calls.
- `/api/cron/learning-findings` (04:15 UTC) — observed tests' verdicts into
  `learning_findings` (see `ENABLE_LEARNING_FINDINGS` above). Zero Meta calls.
- `/api/cron/learning-digest` (Mondays 10:00 UTC) — the weekly learnings digest
  to `ads_ops` (see `ENABLE_LEARNING_DIGEST` above). Off by default.
- `/api/cron/google-ads-daily-insights` (04:00 UTC) — Google Ads campaign,
  search-term and location facts per day (see
  `ENABLE_GOOGLE_ADS_DAILY_INSIGHTS` above). Zero Google Ads mutates.
- `/api/cron/bm-page-scan` (`15 21,1,4 * * *` and `45 22 * * *` UTC: four runs a
  London night, each an hour clear of scan-enhancement-flags 00:45, ad-daily-insights
  02:30 and optimisation-tick 00:00 / 04:00; 23:15 was turned down because
  optimisation-tick skips its tick above 70 % app usage and 00:00 would still hold
  that run's calls) — re-reads every connected Business Manager's pages, ad
  accounts, pixels and IG accounts. Detection only, never grants. BMs whose client
  is archived are skipped; a BM with no `client_id` is scanned. BMs go
  least-recently-scanned first, so each run picks up where the last stopped. The
  run stops starting BMs at whichever comes first: an X-App-Usage field
  (`call_count`, `total_time`, `total_cputime`) read after any Graph call at 80 %
  (`BM_SCAN_USAGE_STOP_PCT`; the BM in progress finishes, the rest are skipped
  `app_usage_80`), the first Meta rate-limit error (`rate_limited`), or 650 s
  (`time_budget`). `stopped_by` says which. `/me/accounts` and the
  business-scoped user ids are read once per token per run. Its `cron_runs` detail
  carries `meta_calls` (every Graph attempt, retries included, counted per run by
  `lib/meta/call-meter.ts`), the X-App-Usage readings `app_usage_last` /
  `app_usage_at_limit` (`{call_count, total_time, total_cputime}` or null), and
  `stopped_at_usage`, `usage_at_stop` and `bms_skipped_usage`. Alarmed in
  `CRON_ALARMS` with `night_all_zero` (`runsPerNight: 4`): a failed run at once; a
  zero only when every run that London night did 0 (a usage stop with a BM done
  is not a zero); 48 h without a run. `lib/bm/scan-run.ts`, `lib/bm/cron-scan.ts`.
- `/api/cron/mcp-scheduled-changes` (every 15 minutes) — the connector's scheduled
  budget changes (M3b, migration 271; see `ENABLE_MCP` above). Applies nothing
  unless `ENABLE_MCP=1` (200 with `skippedReason: "killswitch"`, still a
  `cron_runs` row). Alarmed in `CRON_ALARMS` with `zeroRule: "never"`: a failed
  run (207 when Meta refused one) alarms at once, and 30 minutes without a run.
- `/api/cron/creative-tests-read` (`0 7,8 * * *` UTC, acts at 08:00 London) —
  the creative tests' daily read; TF9's end-day call extends or pauses the test
  ad set (see `ENABLE_CREATIVE_TESTS_READ` above). Off until its switches are set.
- `/api/cron/customer-list-sync` (08:00 London, `"0 7,8 * * *"`; Mondays the full replace) — signups
  into Meta customer lists for enabled shows (see
  `OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED` above). Off until that is set.
- `/api/cron/retargeting-read` (08:00 London, `"0 7,8 * * *"`) — the Retargeting
  campaign's daily read (see `ENABLE_RETARGETING_READ` above). Zero Meta writes.
- `/api/cron/onsale-refresh` (Mondays 06:00 UTC) — the on-sale refresh,
  P1 shadow proposals (see `ENABLE_ONSALE_REFRESH` above). Zero Meta
  writes; Meta is read for the purchase line (ad-set pixels, the pixel's
  purchases by domain), and the other calls out are the cycle folder's
  Drive listing and one public CIRQLIN page per crqln.com signup link. "0 6 * * 1" in
  `vercel.json` (after the 03:30 UTC learning-refresh; 06:00 London in
  winter, 07:00 in summer), and `?post=pending` at "5 10 * * 1" posts the
  proposals business hours held back.

### Canonical spec

`docs/CLIENT_DASHBOARD_BRIEF_2026-04-27.md` is the active reference
for the 4theFans dashboard rollout. It covers readiness rules, venue
grouping, spend attribution, and the weekly-snapshot history flow.

`docs/STRATEGIC_REFLECTION_2026-05-01.md` is the most recent ops-level
strategic reflection, covering the awareness vertical, multi-platform
reporting completion, and BR-readiness sprint state.

### PUBLIC_PREFIXES

The proxy's `PUBLIC_PREFIXES` list (see `lib/auth/public-routes.ts`)
now includes the share surfaces introduced in PR #113 / #120. New
internal surfaces added by the April 2026 session
(`/api/internal/clients/*`, `/api/events/*/manual-tickets/bulk`,
`/api/clients/*/ticketing-import/*`) are **intentionally** NOT in
the allow-list — they require a cookie-bound session and run
ownership checks server-side.

### Mailchimp tag tracking (layered architecture)

Per-event Mailchimp tag growth is tracked by three cooperating layers so the
dashboard chart shows true, API-sourced cumulative data without re-fetching
every contact on each request (replaces the synchronous PR #629 backfill):

1. **Webhooks (real-time)** — `POST /api/webhooks/mailchimp/{clientId}/{audienceId}`
   appends tag add/remove events to `mailchimp_tag_event_log` (deduped) and
   recomputes the affected events' per-day snapshot. The **primary path is the
   classic Profile-updates webhook**: Mailchimp fires a `profile`/`upemail`/
   `cleaned` event on any member change (including tag changes), and
   `handleProfileUpdate` re-fetches the member's `/tags`, diffs against the event
   log, and writes the missing add/remove rows. This is self-correcting and reads
   Mailchimp as the source of truth.

   > Mailchimp **Customer Journeys** ("Tag added" trigger → "Make API call") were
   > evaluated and rejected: journey starts under-report real tag adds (measured
   > 4,230 journey starts vs 4,559 segment members). The handler still parses the
   > JSON shape if one is ever wired up, but **do not** rely on or document it.

   Auth (`isTrusted`, all timing-safe): `?secret=` query param, OR
   `Authorization: Bearer <MAILCHIMP_WEBHOOK_SECRET>` header, OR an
   `x-mailchimp-signature` HMAC-SHA256 of the raw body.
2. **EOD cron (backstop)** — `/api/cron/mailchimp-eod-snapshot` (23:55 UTC) reads
   the segment's authoritative `member_count` and corrects today's snapshot if it
   drifts > 5 from the webhook-maintained value. Segments are fetched once per
   audience per run (in-memory cache) so many events on one audience don't refetch.
3. **Resumable backfill (one-time)** — `POST /api/events/{id}/mailchimp/tag-backfill/start`
   creates a job; `/api/cron/mailchimp-backfill-tick` (per-minute) processes it in
   chunks, reading each member's true tag `date_added`; `…/tag-backfill/status`
   reports progress. Auto-fired when an event gains a `mailchimp_tag` (create or
   PATCH); `scripts/run-mailchimp-tag-backfill.mjs` drives + watches it manually.

All per-day writers use a deterministic `snapshot_at` of `${day}T12:00:00Z` so
the existing `uq_mailchimp_tag_snapshots_event_snapshot_at (event_id, snapshot_at)`
unique index dedupes to one row per UTC day (see `lib/mailchimp/tag-tracking.ts`).

**One-time webhook setup per audience** (primary path): Mailchimp UI → Audience →
Settings → Webhooks → add the event's webhook URL with the `?secret=` query param
(or set `Authorization: Bearer {MAILCHIMP_WEBHOOK_SECRET}` if the transport
supports custom headers), and enable **Profile updates** + **Email changed**.
`handleProfileUpdate` reconciles against Mailchimp's true tag state on every
fire, so day-to-day accuracy comes from the EOD `member_count` backstop +
per-event backfill, not from the webhook being exhaustive.
`GET /api/events/{id}/mailchimp/webhook-url` (session auth) returns the exact URL
+ auth to paste in. Schema: migration `119_mailchimp_bulletproof_tracking.sql`.
