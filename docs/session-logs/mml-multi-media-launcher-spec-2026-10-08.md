# MML — Multi Media Launcher (replaces Plans) — spec 2026-10-08

Matas: the Plans canvas is "clunky, messy and not very useful". MML should be one window for the main controls, audiences and creatives. Everything is uploaded there once and then split out into the individual channels (Meta, TikTok, Google).

Decisions (Matas, 2026-10-08):
- Replace Plans: rename to **MML**, move it under **Platforms** in the nav (above Meta/TikTok/Google Ads), and rebuild the canvas. Existing plans keep working.
- One button launches **paused** in every channel until MML is proven. Launching live comes later.
- Meta audience controls stay exactly as they are in the Meta launcher.
- TikTok default audience: Open (no interests), regional; nationwide if the budget allows.

## What exists (origin/main daeae39) and gets reused
- Canvas: `app/(dashboard)/plan/[id]` → `components/plan/plan-workspace.tsx`. Zones live in `components/plan/canvas-*.tsx`, with logic in `lib/plan/canvas.ts` and `lib/plan/canvas-inputs.ts`. Data: `campaign_plans` (migration 157+) and the 1:1 children `campaign_plan_{meta,tiktok,google}_launch` (draft_id, status).
- Drafts from a plan: `lib/plan/adapters/{meta,tiktok,google}.ts`, `lib/plan/prepare-draft.ts`.
- Budget split: `lib/plan/budget-split.ts` (presets 90-5-5 / 80-15-5 / 70-20-10 / 50-40-10, `allocateByWeights`, `splitLockedEdit`).
- Launch fan-out: `lib/plan/orchestrator.ts` via `/api/plan/launch`, paused, gated by `ENABLE_PLAN_FANOUT`.
- Assets: `creative_assets` (sha256, aspect_ratio 1:1/4:5/9:16/other) and `campaign_plan_asset_routes` (TikTok only). Aspect detection: `lib/clients/asset-queue/aspect-detect(.server).ts`. Meta pairing: `AssetMode` single/dual/full plus `AssetVariation` in `lib/types.ts`, built by `buildMultiPlacementCreative` in `lib/meta/creative.ts`.
- Promoter defaults: `lib/clients/channel-defaults.ts` (default Page, IG, TikTok identity per client).
- Locations: Meta-only `LocationTier` primary/secondary and presets (`lib/meta/location-targeting.ts`, `components/steps/budget-schedule.tsx`). Not shared today.
- AI copy: only `lib/clients/asset-queue/copy-generator.ts` (haiku, no URL scraping).

## MML layout (one page, top to bottom)
1. **Event & promoter**: event, client, promoter identity per channel (from channel-defaults, editable), destination URL.
2. **Creatives**: multi-file drop. Files are auto-sorted into 4:5 / 1:1 / 9:16 / other columns by actual pixel dimensions (filename hints only as a tiebreak), and you can drag between columns. Select 2–3 assets → **Match** → one Meta creative (dual = feed + 9:16, triple = 4:5 + 1:1 + 9:16). Unmatched assets are singles. 9:16 videos also go to TikTok; images never go to TikTok.
3. **Copy**: paste the URL → **Suggest** (server fetch of title / meta / og / JSON-LD Event + event details → Claude suggestions). Ticking suggestions adds them to captions (Meta primary text, TikTok ad text ≤100), headlines and descriptions. Bulk controls: copy caption / URL / CTA / headline / description across all creatives. The same copy seeds the Google Search plan (RSA headlines ≤30, descriptions ≤90) plus keywords and negatives from the event, artist and venue.
4. **Budget & schedule**: today's budget and schedule; channel toggles (Meta / TikTok / Google); recommended split with a draggable split bar.
5. **Locations & placements**: primary/secondary locations (Meta's picker, shared). Mapped to Meta geo, TikTok regional (nationwide when the TikTok budget clears a threshold), and Google resolved geo IDs (with the no-location block). Placements as in Meta.
6. **Generate**: builds or updates all three drafts. Shows one card per channel (summary, blockers, **Adjust** → opens that channel's drawer).
7. **Launch paused**: the existing orchestrator; one button.

## PR sequence (Cursor; each off fresh main, one at a time)
- **M1** Rename + nav + layout shell (no new data).
- **M2** Creative intake: upload, auto-sort, drag, Match, disperse to Meta + TikTok drafts (migration).
- **M3** Copy: URL → suggestions → captions / descriptions / headlines; copy-across; seeds Google Search plan.
- **M4** Budget split UI + shared locations/placements + Generate → three drafts; TikTok Open-audience default.
- **M5** Launch paused across all three, review, polish. A live-launch switch comes after it's proven.

## Prompts
- M1 sent 2026-10-08.
