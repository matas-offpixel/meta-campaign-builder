# Handover — Creative thread: Remotion arc continuation

**Date:** 2026-06-04
**From:** Commercial+Ops thread (Matas)
**To:** Creative thread (next agent session)
**Status:** Week 1 POC SHIPPED. Resuming at validation + Week 2 build.

## Where this thread is picking up

Off/Pixel just shipped Sprint C Week 1 — Remotion programmatic-video integration — as a productionised provider behind `FEATURE_REMOTION`. The architecture, the in-process Vercel render path, and the smoke-test surface are all live on `main`. The flag defaults to `0`. **Nothing is exposed to clients or producers yet.**

The Creative thread now owns the next ~3 weeks of work to turn the POC into a delivered capability: validate the POC end-to-end, flip the flag safely, and then ship Week 2 (variation matrix + render queue + autotag integration) and Week 3 (5-composition template catalogue serving real Ironworks event launches).

## Why this exists — the commercial frame

Don't lose sight of why we built it. Pure execution mode without the why drifts away from the right scope.

1. **Time compression is the north star.** Matas + Sarah are a 2-person agency at ~£13k MRR with a £20k target. Operator time is the binding constraint. Remotion exists to generate ~25-30 platform-native creative variants per event instead of hand-assembling 5 statics.
2. **Closes the competitor gap.** A friend/competitor walkthrough (`docs/COMPETITOR_WORKFLOW_ANALYSIS_2026-05-20.md`) showed Remotion in production at solo-operator scale. We had scoped it three times since April without shipping. This was THE explicit gap.
3. **Repositions pricing.** The MoS / Ironworks / next-tier prospect conversation moves from "we launch campaigns 2 min faster" to "we produce 25-30 platform-native variants per event with CTR-tagged scoring." That's a different price tier.
4. **Reusable infrastructure.** Same Remotion provider serves 4theFans city statics, Junction 2 artist-spotlight motion, Ironworks lineup reveals, Black Butter brand-awareness clips. Build once, serve all clients.

## What shipped (PR #531, merged commit b365910)

**Architecture context (grounded by reading the repo this session, not memory'd):**

- `lib/creatives/types.ts` defines a clean `CreativeProvider` interface: `listTemplates() / render() / pollRender()`. Five providers registered: `canva`, `bannerbear`, `placid`, `remotion`, `manual`.
- Remotion is a fifth `CreativeProviderName`, gated behind `FEATURE_REMOTION` env flag, slotted into the existing registry.
- `lib/creatives/remotion/provider.ts` — synchronous render via `@remotion/renderer.renderStill`, uploads PNG to Supabase Storage at `campaign-assets/remotion-renders/{userId}/{renderId}.png`, returns 7-day signed URL.
- `lib/creatives/remotion/shared.ts` — flag gating, template catalogue, field validation. Separated from `provider.ts` to be testable without Next/Supabase imports.
- `src/remotion/index.tsx` + `src/remotion/compositions/FourTfCityStatic.tsx` — one hardcoded 1080×1080 static composition (`4tfCityStatic`). Inputs: `city, venue, opponent_a, opponent_b, kick_off_at`. Output: PNG with matchup + venue + kick-off on `#0f172a` background, `4TF` text mark bottom-right.
- `scripts/bundle-remotion.ts` + `prebuild` hook — Remotion's `@remotion/bundler` cannot run inside Next API routes (Webpack-in-Webpack), so we bundle at build time, and the provider reads `.remotion/bundle` from disk.
- `app/admin/render-test/page.tsx` + `components/admin/render-test-form.tsx` — admin-only smoke-test UI with 5 form inputs + render trigger + preview.
- `app/api/admin/remotion/render/route.ts` — `maxDuration = 120`, cookie auth via `lib/supabase/server`, returns `{jobId, assetUrl, templateId}`.
- `next.config.ts` — adds `serverExternalPackages` for Remotion + bundler + renderer.
- Dependencies: `remotion`, `@remotion/renderer`, `@remotion/bundler` all pinned at `4.0.471`.

**Validation outcomes (offline smoke):**
- 49,693 byte PNG rendered in ~195ms (after Chrome Headless Shell download).
- All four unit tests pass: flag gating, missing-field validation, template listing.
- `npm run build` exit 0. `npm run lint` clean.

**Docs follow-up (PR #532, merged commit 0ffb9bc):**
- AWS-Lambda-path docs renamed `*_SUPERSEDED_*` with banner blocks. The Vercel path is canonical.
- Section-2 of `docs/REMOTION_SCOPE_2026-05-20.md` carries a banner: AWS Lambda remains right IF we later add long-form (>1 min) video, but for ≤30s the Vercel-only path is correct.

## Canonical source files for the Creative thread

Read these first, in this order. Don't skip them — they are the ground truth.

1. **`CLAUDE.md`** (repo root) — load-bearing invariants for all threads. Especially: branch ownership (`cursor/...` vs `cc/...`), tool-split heuristic, Cowork vs Cursor split.
2. **`docs/cursor-prompts/REMOTION_WEEK1_POC_VERCEL_2026-06-04.md`** — the canonical Cursor prompt that produced PR #531. Has the architecture context the Creative thread needs.
3. **`docs/REMOTION_SCOPE_2026-05-20.md`** — full Sprint A/B/C plan. Sections on Week 2 and Week 3 are still live; section 2 (build/buy) is superseded by the Vercel path.
4. **`docs/COMPETITOR_WORKFLOW_ANALYSIS_2026-05-20.md`** — why we built it. Re-read before scoping Week 2 to keep commercial framing intact.
5. **`docs/IRONWORKS_PROJECT_BRIEF.md`** — Ironworks needs 25+ variants per event by Oct 3. Sets the deadline for Week 3.
6. **`docs/session-logs/pr-531-cursor-creative-remotion-provider-poc.md`** — what was actually built, validation outcomes, open items.

## Open items and acknowledged debt (read before scoping Week 2)

These are non-blocking for the POC but binding for what comes next.

### 1. Pre-Production-flip smoke test (task #25 in Cowork tracker)

`FEATURE_REMOTION=0` in Production right now. Before flipping to `1`, a fresh Vercel Preview instance must successfully render at least once without OOMing or timing out. The reason: on cold start, Remotion downloads Chrome Headless Shell (~94MB). This eats function memory + runtime budget. If a Preview cold-start render fails, we have three options:

- **Bundle Chrome into the build.** Likely busts Vercel's 250MB function size cap; needs measuring.
- **Pre-warm with a Vercel post-deploy webhook.** Hit `/admin/render-test` once after each deploy.
- **Accept the first-render tax.** Document it as expected for the first user post-deploy.

The Creative thread MUST do the Preview smoke before flipping Production. Do not flip on Matas's word alone — the OOM is a deploy-time landmine that will surface to the first real user.

### 2. `render()` is request-context-coupled (task #24)

`lib/creatives/remotion/provider.ts` does a second `auth.getUser()` inside `render()` via a dynamic `await import("@/lib/supabase/server")`. This works for the admin route but breaks any cron / background / CLI caller because `lib/supabase/server` depends on the request-scoped cookie store.

**This will block Week 2 batch rendering** — the cron worker pattern has no cookie context. Fix before building Week 2's queue:

```ts
render(
  template: CreativeTemplate,
  fields: Record<string, unknown>,
  opts: { userId: string },
): Promise<{ jobId: string; status: "done" }>;
```

API route passes `user.id` explicitly. We own the `CreativeProvider` interface; the breaking change is internal-only. Bannerbear / Placid / Canva stubs throw on entry so they're unaffected. This is a one-PR cleanup before the Week 2 work proper.

### 3. Brand assets are placeholders

The composition uses `#0f172a` (neutral dark blue) because no canonical 4theFans brand colour token exists in the repo. The logo is a `4TF` text placeholder because no `public/4tf-logo.{png,svg}` exists. Both are flagged in the PR description.

**Before Week 3 catalogue locks the templates,** Matas needs to either:
- Add the real 4theFans brand colour + logo asset to the repo, or
- Confirm the placeholders are fine for production use.

For Ironworks, same applies — the brand guideline PDF is in Dropbox (link in `IRONWORKS_PROJECT_BRIEF.md`), but no in-repo colour tokens or logos exist yet.

### 4. Sequential renders only

Vercel-path renders run sequentially per request. For Week 2's variation matrix (30 variants per event), we need a queue: `creative_renders.status='queued'` rows processed one-at-a-time by a worker. This is the explicit Week 2 scope but it depends on task #24 being fixed first.

## Recommended Week 2 sequence

Build in this order. Each prior step de-risks the next.

### Step 1 — Decouple `render()` from cookie context [Cursor, Sonnet]

Land task #24 as a single small PR. Branch: `cursor/creative/remotion-render-userid-arg`. Single PR, ~3 files. Validation: existing tests still pass; admin route still works; the provider can now be called from any context.

### Step 2 — Cold-instance Preview smoke [Matas]

Set `FEATURE_REMOTION=1` in Vercel Preview env only. Deploy a fresh Preview from `main`. Trigger `/admin/render-test`. Confirm cold-start render completes <60s without OOM. If it fails, pause Week 2 and resolve the Chrome download path (option 1, 2, or 3 from open item #1).

### Step 3 — Manual end-to-end through Meta [Matas]

Render a PNG. Upload to a paused 4thefans ad via the existing Meta creative upload flow (`storagePath` + `campaign-assets`). Confirm the asset reaches Meta and the ad UI renders the PNG correctly. **This is the proof the integration end-to-end works** — the bit the POC didn't yet validate.

### Step 4 — Variation matrix runner [Cursor, Opus]

This is the architectural piece worth Opus. Scope:

- New table column or row pattern: `creative_renders.status` accepts `queued`. (Confirm schema first — may already support this.)
- Variation runner: takes a base template + JSON input matrix (e.g. `{cities: [...], hooks: [...], lengths: [...]}`), fans out N rows into `creative_renders` with status `queued`.
- Background worker: a Vercel cron (`*/2 * * * *` or similar) picks queued rows, calls `render()` with the appropriate userId, marks `done` on success.
- Idempotency: a queued-row picked twice must not double-render. Use a `claimed_by_cron_at` column or row-level update guard.

Validation gate: paste a 30-input matrix; come back 10 minutes later; 30 PNGs exist in storage with autotag-ready rows in `creative_renders`.

### Step 5 — Autotag integration [Cursor, Sonnet]

When a `creative_renders` row completes, the existing autotag cron should pick it up. Per the existing memory `project_creator_autotag_enabled_state_2026-05-26`, the autotag has been live since 2026-05-12 with dedup + cadence gates post-PR #463. Verify the autotag cron's `WHERE` clause includes new `creative_renders` rows. If not, add the join. Per-render autotag cost is ~one Anthropic call; at 30 renders/event × 4 events/week the cost is well within budget.

### Step 6 — Template library UI [Cursor, Sonnet]

Surface the variation runner on `/creatives/templates` (existing route per `grep` for "creatives/templates"). Pick template → upload matrix CSV or paste JSON → trigger run → watch queue progress. Producer-facing surface, not client-facing. Auth: same admin gate as the test route.

## Recommended Week 3 sequence

Once Week 2's variation matrix proves out, Week 3 catalogues the templates. Five compositions to build, in this order of leverage:

1. **City-variant static (4tF)** — already exists. Promote from hardcoded to a catalogue entry.
2. **Lineup reveal motion (Junction 2 + Ironworks)** — sequential artist-name reveal. Biggest commercial win because Ironworks needs it by Oct 3 for IRWOHD001 (Jamie Jones).
3. **Artist-spotlight motion (Junction 2 + Ironworks)** — artist photo + venue + date with subtle motion.
4. **Ticket-tier fobar (4tF + general)** — matches existing reference creative folder. Used for payday-stretch ticket-warning ads.
5. **UGC-text-overlay (TikTok-native vertical)** — input clip + overlay text, 9:16. Highest creative ceiling, deferred last because TSX authoring time is highest.

Each composition is ~2-4 hours of TSX work plus a test. Plan for 2-3 day Cursor session per composition.

**Week 3 hook to brief intake automation:** when a new event brief lands, auto-queue the per-client default composition set in `creative_renders` with the event's inputs. Producer (Matas/Sarah) reviews + approves before push. This is the actual time-compression win — brief lands → 25+ ad-ready variants in 30 minutes.

## Hard rules the Creative thread must respect

Carried from `CLAUDE.md` + memory:

1. **Branch naming:** `cursor/creative/<feature>` for Cursor execution; `cc/creative/<feature>` for Claude Code single-file fixes. Never edit files on the other tool's branch.
2. **One PR per branch.** No follow-up commits to a merged branch.
3. **Run `git checkout main && git pull --ff-only` before opening any new branch.** Especially after the two PRs landed today.
4. **Wait ~90s between merging PRs** so Vercel doesn't race two deploys.
5. **Session log per PR.** `docs/session-logs/pr-{N}-{branch}.md` per `docs/SESSION_LOG_TEMPLATE.md`, committed in the same PR.
6. **Cross-thread file edits — ASK FIRST.** The Creative thread owns `lib/creatives/*` and `src/remotion/*`. Don't edit `CLAUDE.md`, `lib/types.ts`, `supabase/schema.sql`, `package.json` without Ops owning the merge. Surface the need; Ops lands the batch.
7. **`FEATURE_REMOTION` flag flip discipline:** Preview env first, smoke test on cold instance, THEN Production. Do not skip the Preview step.
8. **Always verify Supabase migrations apply post-merge** (per `feedback_supabase_migration_verification`). Vercel deploys don't auto-run migrations.
9. **Session middleware swallows Bearer auth on `/api/admin/*` routes** unless added to `PUBLIC_PREFIXES` in `lib/auth/public-routes.ts`. If Week 2's cron worker uses a Bearer token, add the route. Current `/api/admin/remotion/render` is cookie-auth so it's fine.
10. **No hand-waving on render-count or cost numbers.** Always query Vercel logs or Supabase counts as source-of-truth; don't reason abstractly. Per `feedback_use_mcps_not_assumptions` + `feedback_no_handwave_when_numbers_dont_match`.

## Commercial constraints the Creative thread should know

The Creative thread will be tempted to over-build (it always is). These constraints define "enough":

- **Ironworks IRWOHD001 launches 3 Oct 2026.** Lineup-reveal composition (template #2) needs to be production-ready by that date. The other four can be staged.
- **The autotag cron runs Sonnet pricing.** Anthropic API spend is on Matas's $50/mo cap (recently re-set per task #4). Variant generation that produces 30 renders/event × 4 events/week is well within budget but the Creative thread should not introduce additional Anthropic calls without flagging cost.
- **No client-facing Remotion surface yet.** All Week 2/3 work is internal-tool only. The producer triggers; the client sees only the rendered ad in Meta. Do not build a "client uploads brief → Remotion auto-renders for them" path; that's a different product.
- **The competitor walkthrough showed Remotion at 100+ renders/week** for one solo operator. Our projected Q3 volume is ~600-900 renders/month. Plan capacity accordingly; don't over-engineer for 10,000+ renders/month.

## Tasks still pending (Cowork tracker)

The Commercial+Ops thread owns these — Creative thread should know they exist but does not action them:

- **#5** — Submit Standard Marketing API tier upgrade
- **#6** — Friday: new Off/Pixel app + screencast prep (parked)
- **#7** — Watch Anthropic billing this week (salvage PR effect)
- **#13** — Audit TikTok advertiser ID on Black Butter + Junction 2 crons
- **#14** — Add Brand Campaign pricing tier to /quote
- **#15** — Document Spark Ad OEmbed pattern in memory
- **#16** — Roll TikTok username-prefix fix into cron writer
- **#20** — Re-check Remotion license at v5.0 upgrade or 3rd employee

## First message the Creative thread should ask

The Creative thread should open with one of these, not assume context:

1. **"Has the Preview cold-instance smoke been run?"** — If no, Step 2 above is the immediate first action before any code work.
2. **"What's the priority order — Week 2 queue or Week 3 first composition?"** — Default answer is Week 2 queue (it unblocks all of Week 3) but Matas may have a commercial trigger that flips it (e.g. an Ironworks creative review meeting).
3. **"Are 4theFans brand colour + logo assets in the repo yet?"** — If no, the catalogue work is gated on this.

Don't start coding without these three answers.

---

## TL;DR for the Creative thread

You're inheriting a shipped Remotion provider on Vercel. POC validated offline. Flag is off. The next ~3 weeks of work are: validate the POC end-to-end on Preview, fix the request-coupling debt (task #24), build a render queue + variation matrix (Week 2), and ship a 5-composition catalogue (Week 3) with Ironworks IRWOHD001 (3 Oct) as the deadline trigger.

Read `CLAUDE.md`, `REMOTION_WEEK1_POC_VERCEL_2026-06-04.md`, `REMOTION_SCOPE_2026-05-20.md`, and the session log for PR #531 before touching anything.

Time compression is the north star.
