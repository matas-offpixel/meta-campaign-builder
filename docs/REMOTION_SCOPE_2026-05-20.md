> ℹ️ **2026-06-04 update.** Section 2 ("Build / buy on Remotion") is partially superseded — the Lambda recommendation flipped to in-process Vercel render when the output spec narrowed to ≤30s. AWS Lambda remains the right call IF we later add long-form video output (>1 min). Currently we do not.
>
> Week-1 POC shipped via PR #531 using the Vercel-only path.

# Remotion scope — Sprint C commercial unlock

**Date:** 2026-05-20
**Owner:** Creative thread
**Status:** Scope draft for review

## Context (grounded, not memory'd)

Verified by reading the repo this session:

- `lib/creatives/types.ts` defines a clean **`CreativeProvider` interface**: `listTemplates()` / `render()` / `pollRender()`.
- `lib/creatives/registry.ts` is a `CreativeProviderName → implementation` map. Four providers registered today: `canva` (gated on Canva Enterprise), `bannerbear` (stub), `placid` (file present, not inspected), `manual` (DB-only templates).
- Bannerbear provider is a literal stub — every method throws `CreativeProviderDisabledError`. Comment: *"Real implementation lands when the Bannerbear account is provisioned."*
- DB schema: `creative_templates` + `creative_renders` rows already typed. Migrations 031 (templates), 061 (tags), 068a, 096.

**This is structurally better than the strategic-reflection language suggested.** The provider abstraction is done. Remotion is a fifth `CreativeProviderName`, dropping into the existing registry. No new primitives needed.

## Why Remotion, not finishing Bannerbear

Both have the same render API shape (render → poll). The choice is on output type, not integration shape.

**Bannerbear** is template-based image/video composition. Strong for static + simple animated. Hosted API, ~$49-99/mo.

**Remotion** is React-based programmatic video. Strong for **complex, story-driven motion graphics** — the variant-style content the competitor's walkthrough showed (city/hook/script variations with real motion). Self-hosted or hosted via Remotion Lambda. Pricing scales with render minutes.

For the Off/Pixel use case (TikTok-native short edits, UGC-style content, motion-heavy hooks for electronic-music events), **Remotion is the right tool**. Bannerbear is closer to what Canva would do if Canva had an API — useful for static admat variants but not for the motion-content gap.

**Decision: ship Remotion as a fifth provider. Leave Bannerbear stub in place** — it still serves the static-variation use case if we want it later, and the stub costs nothing.

## Build / buy on Remotion

Two paths:

### Option A — Remotion Lambda (hosted)
- AWS Lambda functions Remotion provides for rendering.
- ~$0.0005-0.002 per second of rendered video (depends on resolution/codec).
- Zero infra setup. We pay AWS direct.
- Setup time: hours, not days.
- Output goes to S3 → we transfer to Supabase Storage (already provisioned for video uploads per PR #462).

### Option B — Self-host on Vercel/Render/Fly
- Remotion CLI runs in any Node environment with headless Chrome.
- Vercel functions are too short (15min cap on Pro) for non-trivial renders. Render minute-by-minute pricing makes this expensive.
- Fly.io or Render.com worker = ~$10-30/mo for the worker. Cheaper at volume but operational overhead.
- Setup time: 1-2 days.

**Recommendation: Lambda for the POC, evaluate self-host at 100+ renders/week.** Lambda's per-render pricing is the right shape while we're proving the concept. Below 100 renders/week the Lambda bill stays trivial (likely under $20/mo). If volume scales past that we revisit.

## Sprint structure

### Week 1 — POC

**Goal:** one variant produced from Remotion, uploaded to Meta, running as a live ad for a low-stakes event.

**Scope:**
1. Create `lib/creatives/remotion/` mirroring `lib/creatives/bannerbear/`.
2. New `CreativeProviderName = "remotion"` added to types + registry.
3. `FEATURE_REMOTION` env flag (matches existing flag pattern).
4. Implement `render()` against Remotion Lambda — single hardcoded composition (4thefans city-statics, see below). Returns AWS Lambda invocation ID as `jobId`.
5. Implement `pollRender()` checking S3 for completed output. On success, download to Supabase Storage (reuse `lib/storage/` patterns from PR #462), return signed Supabase URL as `assetUrl`.
6. **One Remotion composition.** Hardcode it. Inputs: `{ city, venue, opponent_a, opponent_b, kick_off_at }`. Output: 1080×1080 static feed-style with team badges + venue + countdown.
7. Wire to a hidden `/admin/render-test` route that lets us trigger renders with hardcoded inputs from the UI. No client-facing surface yet.

**Validation gate:**
- Render completes end-to-end in under 60s.
- Output uploads to a Meta ad account via existing creative upload flow.
- Ad runs PAUSED on a 4thefans low-stakes event (Sunday lower-league or similar).
- No regression on existing Bannerbear/Canva flag paths.

**Out of scope week 1:**
- Variation generation (one render per input, no loops).
- Template library UI.
- Autotag integration.
- Per-event scheduling.

### Week 2 — Template library + variation loop

**Goal:** 30 variants overnight per event.

**Scope:**
1. Compositions library — abstract the week-1 hardcoded composition into a typed catalogue. Each composition is a TSX file in `compositions/` mapped to a `CreativeTemplate` row via `external_template_id`.
2. Variation runner — given a base composition + a JSON input matrix, fan out N renders in parallel against Lambda. (e.g. 5 hooks × 3 cities × 2 lengths = 30 renders.)
3. Surface in the `/creatives/templates` route — pick template, paste/upload input matrix, click run, watch the render queue.
4. Autotag integration — write completed renders into `creative_renders` with appropriate `creative_tag_assignments` so they enter the autotag scoring loop automatically.
5. Per-event linkage — `creative_renders.event_id` already exists; populate it from the trigger context.

**Validation gate:**
- 30 variants render in under 10 minutes total (parallel Lambda).
- All 30 land in `creative_renders` with autotag tags applied.
- Manual smoke test: pick the top-scoring 5 by health badge, push to a real campaign as ads.

### Week 3 — Per-event template catalogue

**Goal:** every event-promoter client gets a default composition set on intake.

**Scope:**
1. Catalogue the compositions we want:
   - **City-variant static** (4thefans use case — week 1 hardcoded version, now in catalogue).
   - **Artist-spotlight motion** (Junction 2 / Ironworks use case — artist photo + venue + date with motion).
   - **Lineup reveal motion** (Junction 2 / Ironworks use case — sequential reveal of artist names with audio reactivity).
   - **Ticket-tier fobar** (matches existing 4tF reference creative folder).
   - **UGC-text-overlay** (TikTok-native short edit — input clip + overlay text, vertical 9:16).
2. Brief intake automation hook — when a new event lands via brief intake, auto-create a `creative_renders` queue entry for each catalogue composition with the event's basic inputs. Producer (you/Sarah) reviews + approves before push.
3. Per-client default catalogue — `clients.default_composition_set` or similar; the brief intake honours it.

**Validation gate:**
- Ironworks event #1 (IRWOHD001 — Jamie Jones, 3 Oct) gets 25+ default variants auto-queued from brief intake alone.
- Time from brief intake → 25 ad-ready variants under 30 minutes.

## Integration touchpoints

### Creative library schema (mig 061 + 068a + 096)
- `creative_tag_assignments` runs against `creative_renders.asset_url` once the render completes. Autotag cron picks up new renders on its 6h tick (or after PR #463's salvage, post-volume reduction).
- `creative_tags` taxonomy doesn't need extension — Remotion outputs are tagged on the same dimensions as upload-via-wizard creatives.

### Autotag cost
- Each Remotion render adds one autotag call when first tagged. At 30 variants/event × 4 events/week = ~120 extra autotag calls/week. Post-PR #463 dedup + cadence, this is well within Anthropic budget. Watch initial week post-launch to confirm.

### Storage
- Use the Supabase Storage path PR #462 added for video uploads. Same signed-URL approach, same RLS scoping. Don't add a new storage bucket.

### Secrets model
- `REMOTION_LAMBDA_ACCESS_KEY`, `REMOTION_LAMBDA_SECRET`, `REMOTION_LAMBDA_REGION`, `REMOTION_LAMBDA_FUNCTION_NAME`, `REMOTION_S3_BUCKET` → Vercel env vars (server-only).
- For Cursor + Cowork to both invoke renders during development: same approach as Meta — secrets in Vercel for prod, `.env.local` for Cursor dev, Cowork doesn't need to invoke renders itself (it can trigger via the existing API routes once those exist, no direct AWS access from Cowork).

### Skill-file pattern alignment (from competitor lesson)
- Once Week 2 lands, ship a `skills/remotion-variations/SKILL.md` that wraps the variation runner. Then any Cowork or Cursor session can say *"generate 30 variants for IRWOHD001 using the artist-spotlight composition with these hooks"* and get the output without clicking through the wizard.
- This is the skill-file-over-PR-route principle applied — the wizard surface stays for client-facing trust + audit, the skill wraps it for internal speed.

## Non-goals / explicit refusals

- **Not removing Bannerbear stub.** It costs nothing and may serve future static-variation needs.
- **Not building a Remotion-editor UI.** Compositions are TSX in the repo; we author them in Cursor. Building a no-code composition editor would burn weeks for no commercial gain.
- **Not auto-pushing renders to live campaigns.** Every render passes through producer review before becoming an ad. The autotag scoring helps the producer pick, but the human is the last step.
- **Not bypassing the existing creative upload flow.** Remotion outputs land in Supabase Storage → flow through the existing `lib/meta/upload.ts` path to Meta. Same audit trail.

## Risks + open questions

1. **Lambda cold-start latency.** First render of the day might take 30-45s. Acceptable. If it becomes an issue, Remotion supports warming hooks.
2. **Composition author productivity.** TSX compositions take a few hours each to author cleanly. The week-3 catalogue of 5 compositions is ~2-3 days of TSX work. Worth scoping a Cursor session specifically for this.
3. **Audio rights for motion templates.** Lineup-reveal motion typically benefits from a music bed. We don't have a rights-cleared bed library. Open question: license one (Epidemic Sound ~$15/mo agency tier) or keep audio off the templates initially.
4. **Output codec compatibility.** Meta accepts H.264 MP4 happily. TikTok same. Confirm Remotion Lambda defaults to H.264; if not, set explicitly.
5. **Volume sanity.** Per the projection model, we're at 4-6 events/month per active client, 4-5 active clients = ~20-30 events/month. At 30 variants per event that's 600-900 renders/month. Lambda cost at $0.001/sec × ~10s avg = $6-9/month. Negligible.

## Commercial framing (for the MoS / Ironworks pitch)

**"We produce 25-30 platform-native creative variants per event campaign, generated programmatically and scored against a tagging taxonomy that surfaces the highest-performing hooks for your audience. That's an order of magnitude more A/B coverage than the agency norm of 5 static variants per campaign — and our variants are CTR-tagged so the next event's variants inherit what worked last time."**

This language is the actual unlock. It's why the order in the Cowork ops thread was "Remotion before Sprint A/B." Sprint A saves Matas 2 minutes per launch. Remotion changes the answer to *"what do you produce per campaign?"*

## Action items

1. **Creative thread, this week:** prototype week-1 POC. Single TSX composition, Lambda integration, render-test admin route. Test on 4thefans low-stakes event.
2. **Ops thread, this week:** check Epidemic Sound agency tier pricing; spike whether Remotion Lambda renders include audio cleanly.
3. **Ops thread, post-week-1:** draft the MoS / Ironworks pitch language updates that bake in the variant-volume claim. Don't claim it until week-1 POC validates.
4. **Memory after week-1 lands:** save `project_creative_remotion_provider_shipped_2026-XX-XX.md` with build/buy decision, render time, autotag integration notes.
