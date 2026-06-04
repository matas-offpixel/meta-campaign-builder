> ✅ **Shipped 2026-06-04 via PR #531** (commit b365910). This is the Cursor prompt that produced the live Remotion provider.
>
> Refer to this file (not the AWS variant) for the architecture context behind Off/Pixel's current Remotion integration.

# Cursor prompt — Remotion Week 1 POC (Vercel-only, no AWS)

**Tag:** `[Cursor, Sonnet]`
**Branch:** `cursor/creative/remotion-provider-poc`
**Supersedes:** `REMOTION_WEEK1_POC_2026-06-04.md` (the AWS Lambda variant — output spec changed to ≤30s, Lambda no longer needed)
**Prereq:** none — all infra runs inside our existing Vercel + Supabase setup
**Scope target:** ~6-10 files, single PR, ships behind `FEATURE_REMOTION` flag

## Why no AWS

Output spec is **≤30 second videos and stills**. Render time fits comfortably inside Vercel Pro's 800-second function limit. No need for AWS Lambda + S3 + IAM + Remotion CLI deploy. Remotion's `@remotion/renderer` runs in-process. We save the AWS setup + the recurring Lambda spend (was projected $6-9/mo, now £0).

Copy the block below into Cursor.

---

```
GOAL
Add Remotion as a 5th CreativeProvider, behind FEATURE_REMOTION, with one hardcoded composition and an admin-only render-test route. Renders run synchronously in a Vercel API route, output uploaded to Supabase Storage, signed URL returned. End-to-end target: render completes in <60s, URL is valid, manual smoke test produces a PNG/MP4 a producer would accept as an ad asset.

GROUNDING (DO NOT INVENT)
- Provider interface: lib/creatives/types.ts defines CreativeProvider with listTemplates() / render() / pollRender(). Match this shape exactly.
- Registry: lib/creatives/registry.ts maps CreativeProviderName → impl. Add "remotion" to both the type union and the registry.
- Existing stub pattern: lib/creatives/bannerbear/provider.ts is the shape to mirror. DO NOT delete the Bannerbear stub — leave it in place.
- Supabase Storage bucket: "campaign-assets". 200MB size limit, allowed MIMEs ["video/mp4", "video/quicktime", "video/webm", "image/jpeg", "image/png"]. DO NOT add a new bucket.
- Service role key for storage admin ops: SUPABASE_SERVICE_ROLE_KEY (already in env vars).
- Existing storage ensure-bucket route: app/api/storage/ensure-bucket/route.ts — read it to understand the pattern.
- Existing upload-asset route: app/api/meta/upload-asset/route.ts — reads storagePath + storageBucket. The Remotion provider should write its output to a Storage path compatible with this so a producer can hand-trigger Meta upload using the existing flow.
- Tables already exist: creative_templates + creative_renders (migrations 031, 061, 068a, 096). Use them; do NOT add new tables this PR.
- Vercel function limit: 800s on Pro. Renders are ≤30s output; render compute time is roughly 1-2× output duration. Synchronous render fits.

WHAT TO BUILD

1. lib/creatives/types.ts
   - Add "remotion" to the CreativeProviderName union.
   - Add isRemotionEnabled() helper using the existing flagOn() pattern (matches isBannerbearEnabled/isPlacidEnabled).

2. lib/creatives/remotion/provider.ts
   - Implements CreativeProvider interface.
   - name = "remotion" as const.
   - Gates every method on isRemotionEnabled() — throws CreativeProviderDisabledError("remotion", ...) when off, matching the Bannerbear pattern.
   - listTemplates(): returns a hardcoded single-template array:
       [{
         externalTemplateId: "4tf-city-static-v1",
         name: "4theFans city static (v1)",
         channel: "feed",
         aspectRatios: ["1:1"],
         fields: [
           { key: "city", label: "City", type: "text", required: true },
           { key: "venue", label: "Venue", type: "text", required: true },
           { key: "opponent_a", label: "Team A", type: "text", required: true },
           { key: "opponent_b", label: "Team B", type: "text", required: true },
           { key: "kick_off_at", label: "Kick-off (ISO)", type: "text", required: true },
         ],
       }]
   - render(template, fields):
     - Validate required fields against the descriptor — throw on missing.
     - Render synchronously in-process using @remotion/renderer's renderMedia (for video) or renderStill (for the v1 static PNG).
     - Bundle the Remotion entry: use @remotion/bundler's bundle() once at module load, cache the bundle URL in a module-scoped variable so we don't re-bundle on every render.
     - Pick composition "4tfCityStatic" via @remotion/renderer's selectComposition with the inputProps.
     - Call renderStill with the bundle URL, composition, inputProps, output to a Node temp file (os.tmpdir()).
     - Read the temp file, upload to Supabase Storage at path `remotion-renders/{userId}/{renderId}.png` in bucket "campaign-assets" using the service-role admin client (mirror the pattern from app/api/storage/ensure-bucket/route.ts).
     - Delete the temp file.
     - Create signed URL via supabase.storage.from("campaign-assets").createSignedUrl(path, 60*60*24*7) — 7 days.
     - Returns { jobId: storagePath, status: "done" }. (Note: synchronous render means status is "done" on return. jobId = the storage path so pollRender can re-issue a signed URL later.)
   - pollRender(jobId):
     - jobId is the storage path. Re-issue a fresh signed URL (existing ones expire after 7 days).
     - Returns { jobId, status: "done", assetUrl: <signed url> }.
     - If the storage object doesn't exist anymore, return { jobId, status: "failed", errorMessage: "Render not found" }.

3. lib/creatives/registry.ts
   - Add remotion: remotionProvider to the providers map.
   - Import { remotionProvider } from "./remotion/provider".

4. src/remotion/index.ts
   - Remotion composition entry point. Registers a single composition with id "4tfCityStatic".
   - Composition: width 1080, height 1080, durationInFrames 1, fps 30 (static PNG).
   - inputProps schema typed as: { city: string; venue: string; opponent_a: string; opponent_b: string; kick_off_at: string }.

5. src/remotion/compositions/FourTfCityStatic.tsx
   - React component rendering a 1080×1080 still:
     - Solid background (4theFans brand colour — check tailwind.config.ts or any 4tF brand reference in the repo; if not found, use a neutral dark blue like #0f172a and flag in PR description).
     - Large centered text: `${opponent_a} vs ${opponent_b}`.
     - Below: venue + city.
     - Below: kick_off_at formatted as "Sat 3 Oct, 19:30" using Intl.DateTimeFormat (do NOT add date-fns or moment — it's already in the bundle, keep it lean).
     - 4theFans logo bottom-right if public/4tf-logo.{png,svg} exists; else placeholder.
   - No animation, no audio. Static PNG is the entire week-1 deliverable.
   - Use Remotion's <AbsoluteFill> + standard React inline styles. No Tailwind in Remotion components (Tailwind compilation doesn't run in the Remotion bundler context).

6. app/admin/render-test/page.tsx
   - Check existing admin routes first to find the auth pattern (look at any app/admin/* page). Mirror that pattern. DO NOT invent a new auth check.
   - Client-component form with 5 inputs matching the descriptor.
   - On submit: POST to /api/admin/remotion/render with the fields + templateId.
   - Renders synchronously so no polling needed — show a spinner, await response, then show asset URL + copy button + image preview.

7. app/api/admin/remotion/render/route.ts
   - POST handler. Admin-only auth (same pattern as other admin routes).
   - Body: { templateId: string, fields: Record<string, unknown> }.
   - Calls getCreativeProvider("remotion").listTemplates() to find the matching template.
   - Calls getCreativeProvider("remotion").render(template, fields).
   - Returns { jobId, assetUrl } (since render is synchronous and pollRender re-issues the URL, we can call pollRender immediately and return the URL).
   - export const maxDuration = 120 (give it 2 min headroom).

8. package.json
   - Add dependencies (use --save-exact):
     - @remotion/renderer
     - @remotion/bundler
     - remotion (the core peer)
   - DO NOT add @remotion/lambda. Not needed.

9. Tests
   - lib/creatives/remotion/provider.test.ts:
     - render() throws CreativeProviderDisabledError when FEATURE_REMOTION is off.
     - render() throws on missing required field.
     - listTemplates() returns the hardcoded template when flag is on.
   - DO NOT mock the actual @remotion/renderer call in the unit test — keep the test focused on the gating + validation logic. Integration testing of the actual render is manual via the admin route.

10. PR description must include
    - Validation steps you ran (npm run build, lint, tests).
    - Output of the first successful render: signed URL + screenshot/inline preview.
    - Confirm FEATURE_REMOTION defaults to 0 in production env vars.
    - Note any open items: 4tf brand colour resolution, logo asset existence, etc.

CONSTRAINTS
- DO NOT delete the Bannerbear or Placid stubs. Leave the entire lib/creatives/bannerbear/ and lib/creatives/placid/ directories in place.
- DO NOT change the existing CreativeProvider interface. Match it exactly.
- DO NOT add a new Supabase Storage bucket. Use "campaign-assets".
- DO NOT auto-flip FEATURE_REMOTION to 1 in this PR. The flag stays at 0 until Matas validates the POC manually.
- DO NOT push the rendered output to a live ad in this PR. The admin route just returns the URL — Matas tests Meta upload manually using the existing creative upload flow (it'll work because the file is already in campaign-assets bucket, same as video uploads).
- DO NOT introduce Tailwind into Remotion compositions. Inline styles only.
- DO NOT use @remotion/lambda. We're rendering in-process on Vercel.
- DO NOT re-bundle the Remotion entry on every render. Bundle once at module load, cache.

VALIDATION GATE (before requesting review)
- npm run build: exit 0.
- npm run lint: clean on touched files.
- node --test lib/creatives/remotion/provider.test.ts: passes.
- Local dev (npm run dev with FEATURE_REMOTION=1 in .env.local):
  - Visit /admin/render-test.
  - Fill the 5 inputs (e.g. city="Manchester", venue="Etihad", opponent_a="Man City", opponent_b="Liverpool", kick_off_at="2026-10-15T19:30:00Z").
  - Click render.
  - Get a signed URL back within 60s. Open the URL in a new tab — should display the PNG.
  - Confirm the file is at campaign-assets/remotion-renders/{userId}/*.png in Supabase Storage UI.
- Lighthouse-check the rendered PNG — must be visually acceptable as an ad asset (legible text, brand-colour background, not visibly broken).

OUT OF SCOPE (week 1 — DO NOT BUILD)
- Variation loops / matrix input (week 2).
- Template library UI for non-admin users (week 2).
- Autotag integration on completed renders (week 2).
- Per-event linkage of creative_renders.event_id (week 2).
- Additional compositions beyond the 4tF city static (week 3).
- Audio in compositions (week 3).
- Meta auto-upload of rendered assets to live ads (separate PR — Matas tests manually using existing flow).
- Render queue (week 2 — synchronous-in-API-route is fine at v1 because we're triggering single renders manually from the admin route).

ASK BEFORE DOING IF
- The existing admin-route auth pattern doesn't exist or is unclear — surface, don't invent.
- 4theFans brand colour or logo asset can't be located — use a neutral placeholder and flag in PR description.
- @remotion/renderer's API has changed since the docs you trained on — check https://www.remotion.dev/docs and use current API names. renderStill / renderMedia / selectComposition / bundle are the relevant functions today.
- The Vercel function runtime doesn't include the system fonts Remotion needs — surface, may need a font asset committed to the repo. (Most likely not an issue for v1 since the static uses one text colour and a sans-serif fallback works, but flag if you hit it.)
```

---

## What changed vs the AWS variant

| | AWS Lambda variant | Vercel-only variant |
|---|---|---|
| Infrastructure setup | 30-60 min AWS provisioning, IAM, CLI install, function deploy | None |
| Recurring cost | $6-9/mo Lambda after free credit | £0 (Vercel function time included in Pro) |
| Render path | Vercel API → Lambda → S3 → Supabase Storage | Vercel API → temp file → Supabase Storage |
| Cold-start latency | 30-45s first render | Negligible (same Vercel cold-start as any route) |
| Parallel-render throughput | 200× concurrent | Sequential per request, bound by Vercel concurrency limits |
| Env vars added | 6 (AWS keys + Lambda function name + serve URL + region) | 1 (`FEATURE_REMOTION`) |

The trade-off is **lost parallelism**. We can no longer fire 30 variants and have them all back in 30 seconds — they'd run sequentially. For week-1 POC where we're triggering one render at a time from an admin form, this doesn't matter. For week-2 batch generation (30 variants per event), we'll likely add a simple `creative_renders.status='queued'` worker pattern, but that's still cheaper than Lambda for our volume.

## After Cursor ships

1. Matas validates the admin render flow end-to-end. Confirm the PNG opens, the Supabase URL works in incognito, the visual design is acceptable for ad use.
2. Manually upload one rendered PNG to a 4thefans PAUSED ad via the existing Meta creative upload flow.
3. If validation gate passes, flip `FEATURE_REMOTION=1` in **Vercel Preview only first**. Stage gate before Production.
4. Save memory `project_creative_remotion_provider_shipped_2026-06-XX.md` with: render time observed, file size, any surprises (font handling, Vercel function memory ceiling).
5. Week 2 prompt (variation matrix + render queue + template library) opens once POC validates.
