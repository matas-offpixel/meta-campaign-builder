> ⚠️ **SUPERSEDED 2026-06-04.** AWS Lambda render path replaced by in-process Vercel render. See `docs/cursor-prompts/REMOTION_WEEK1_POC_VERCEL_2026-06-04.md` for the canonical Cursor prompt that produced PR #531.
>
> Kept for history. Do not action.

# Cursor prompt — Remotion Week 1 POC

**Tag:** `[Cursor, Sonnet]`
**Branch:** `cursor/creative/remotion-provider-poc`
**Prereq:** `docs/REMOTION_AWS_SETUP_2026-06-04.md` steps 1-7 complete (AWS provisioned, Vercel env vars added, `FEATURE_REMOTION=0`)
**Scope target:** ~6-10 files, single PR, ships behind `FEATURE_REMOTION` flag

Copy the block below into Cursor.

---

```
GOAL
Add Remotion as a 5th CreativeProvider, behind FEATURE_REMOTION, with one hardcoded composition and an admin-only render-test route. End-to-end target: render completes in <60s, output lands in Supabase Storage, runs as a PAUSED ad on a 4thefans low-stakes event.

GROUNDING (DO NOT INVENT)
- Provider interface: `lib/creatives/types.ts` defines `CreativeProvider` with `listTemplates() / render() / pollRender()`. Match this shape exactly.
- Registry: `lib/creatives/registry.ts` maps `CreativeProviderName → impl`. Add `remotion`.
- Existing stub pattern: `lib/creatives/bannerbear/provider.ts` is the right shape to mirror. Do NOT delete the Bannerbear stub — leave it in place.
- Storage: reuse the Supabase Storage upload path from PR #462 (`lib/storage/` if it exists, otherwise the path used by video upload). Do NOT add a new bucket.
- Tables: `creative_templates` + `creative_renders` already exist. Use them; do NOT add new tables this PR.
- Env vars: `REMOTION_AWS_ACCESS_KEY_ID`, `REMOTION_AWS_SECRET_ACCESS_KEY`, `REMOTION_AWS_REGION`, `REMOTION_LAMBDA_FUNCTION_NAME`, `REMOTION_LAMBDA_SERVE_URL`, `REMOTION_S3_BUCKET`, `FEATURE_REMOTION`. These are set in Vercel + .env.local per the AWS setup runbook. If `REMOTION_LAMBDA_SERVE_URL` is missing because step 6 hasn't run yet, your PR runs step 6 as part of the build and surfaces the URL — see below.

WHAT TO BUILD

1. `lib/creatives/types.ts`
   - Add `"remotion"` to the `CreativeProviderName` union.
   - Add `isRemotionEnabled()` helper using the existing `flagOn()` pattern.

2. `lib/creatives/remotion/provider.ts`
   - Implements `CreativeProvider` interface.
   - `name = "remotion"`.
   - Gates every method on `isRemotionEnabled()` — throws `CreativeProviderDisabledError("remotion", ...)` when off, matching the Bannerbear pattern.
   - `listTemplates()`: returns a hardcoded single-template array for now — `{ externalTemplateId: "4tf-city-static-v1", name: "4theFans city static (v1)", channel: "feed", aspectRatios: ["1:1"], fields: [...] }`. Field descriptors: city (text, required), venue (text, required), opponent_a (text, required), opponent_b (text, required), kick_off_at (text, required, ISO date).
   - `render(template, fields)`:
     - Validate fields against the descriptor.
     - Call `renderMediaOnLambda` from `@remotion/lambda/client` with the configured function name, serve URL, composition id `"4tfCityStatic"`, and the fields as inputProps.
     - Image render (PNG single frame) — use `renderStillOnLambda` for the static use case rather than `renderMediaOnLambda`. Confirm which one supports stills before wiring.
     - Returns `{ jobId, status: "rendering" }` — jobId = Lambda's bucketName + renderId tuple, serialized as a single string (e.g. `"<bucket>:<renderId>"`).
   - `pollRender(jobId)`:
     - Parse the bucket+renderId tuple back out.
     - Call `getRenderProgress` from `@remotion/lambda/client`.
     - On `done`: download the S3 output, upload to Supabase Storage (`creative-renders` bucket OR whatever the PR #462 video bucket is — confirm), return signed URL as `assetUrl`.
     - On `failed`: return error message.
     - On in-progress: return `{ status: "rendering" }`.

3. `lib/creatives/registry.ts`
   - Add `remotion: remotionProvider` to the providers map.
   - Import `remotionProvider` from `./remotion/provider`.

4. `src/remotion/index.ts`
   - Remotion composition entry point. Registers a single composition with id `"4tfCityStatic"`.
   - Composition dimensions: 1080×1080, durationInFrames 1 (static — single PNG), fps 30.
   - inputProps schema: `{ city: string, venue: string, opponent_a: string, opponent_b: string, kick_off_at: string }`.

5. `src/remotion/compositions/FourTfCityStatic.tsx`
   - React component rendering a 1080×1080 still:
     - Background colour (use a 4theFans brand colour — check `tailwind.config.ts` or any 4tF brand reference in the repo; ask if unclear).
     - Centered text: opponent_a vs opponent_b
     - Below: venue + city
     - Below: kick_off_at formatted as "Sat 3 Oct, 19:30"
     - 4theFans logo in a corner if a logo asset exists in `public/` — if not, leave a placeholder rectangle and flag it back in the PR description.
   - No animation, no audio, no fancy motion graphics. Static PNG is the entire week-1 deliverable.

6. `app/admin/render-test/page.tsx` (or wherever admin routes live — check existing admin routes first, mirror that auth pattern)
   - Server component. Server-side render auth: require admin user (same pattern as other admin routes — do NOT invent a new auth check).
   - Client-side form with 5 inputs matching the field descriptor.
   - On submit: POST to `/api/admin/remotion/render` with the fields + templateId.
   - Polls `/api/admin/remotion/render/[jobId]` every 2s.
   - On done: shows the asset URL + a copy-button.

7. `app/api/admin/remotion/render/route.ts`
   - POST handler. Admin-only auth.
   - Calls `getCreativeProvider("remotion").render(template, fields)`. Returns `{ jobId }`.

8. `app/api/admin/remotion/render/[jobId]/route.ts`
   - GET handler. Admin-only auth.
   - Calls `getCreativeProvider("remotion").pollRender(jobId)`. Returns the RenderJob.

9. `package.json`
   - Add `@remotion/lambda` and `@remotion/cli` as dependencies (use --save-exact).
   - Add a script `"remotion:deploy-site": "remotion lambda sites create src/remotion/index.ts --site-name=offpixel-renders"`.

10. Tests
    - `lib/creatives/remotion/provider.test.ts` — tests that:
      - `render()` throws `CreativeProviderDisabledError` when `FEATURE_REMOTION` is off.
      - `render()` validates required fields and throws on missing.
      - Mock the Lambda client; assert it's called with the right composition id + input props.

11. PR description
    - Validation steps you ran.
    - Output of the first successful render (S3 URL + Supabase URL + screenshot if possible).
    - Confirm `FEATURE_REMOTION` defaults to `0` in production env vars.
    - Note any open items (e.g. logo asset placeholder, Supabase bucket name resolution).

CONSTRAINTS
- Do NOT delete the Bannerbear stub. Leave the entire `lib/creatives/bannerbear/` directory in place.
- Do NOT change the existing CreativeProvider interface. Match it exactly.
- Do NOT add a new Supabase Storage bucket if a creatives/videos bucket already exists from PR #462.
- Do NOT auto-flip `FEATURE_REMOTION` to `1` in this PR. The flag stays at `0` until Matas validates the POC manually.
- Do NOT push the rendered output to a live ad in this PR. The admin route just returns the URL — Matas tests Meta upload manually using the existing creative upload flow.
- Do NOT skip the AWS-region check. Lambda function, S3 bucket, and serve URL all in eu-west-1.

VALIDATION GATE (before requesting review)
- `npm run build`: exit 0.
- `npm run lint`: clean on touched files.
- Tests pass: `node --test lib/creatives/remotion/provider.test.ts`.
- Local dev (`npm run dev`): visit `/admin/render-test`, fill inputs, render, get an S3 URL + Supabase URL back. Manually confirm both URLs are valid.
- Confirm via `npx remotion lambda functions ls` that the function exists before invoking.

OUT OF SCOPE (week 1 — DO NOT BUILD)
- Variation loops / matrix input (week 2).
- Template library UI for non-admin users (week 2).
- Autotag integration on completed renders (week 2).
- Per-event linkage of `creative_renders.event_id` (week 2).
- Additional compositions beyond the 4tF city static (week 3).
- Audio in compositions (week 3).
- Meta auto-upload of rendered assets to live ads (separate PR).

ASK BEFORE DOING IF
- The Supabase Storage bucket name from PR #462 isn't obvious — surface the question, don't invent.
- An existing admin auth pattern doesn't exist in the repo — surface, don't invent.
- 4theFans brand colour or logo asset can't be located — use a neutral placeholder and flag in PR description.
- `renderStillOnLambda` vs `renderMediaOnLambda` choice is unclear for static PNG — surface, don't guess.
```

---

## After Cursor ships

1. Matas tests the admin render flow end-to-end. Confirm the rendered PNG opens, the Supabase URL works in incognito, and the visual design is acceptable for ad use.
2. Manually upload one rendered PNG via the existing Meta creative upload flow to a 4thefans PAUSED ad.
3. If validation gate passes, flip `FEATURE_REMOTION=1` in Vercel Preview only first. Stage gate before Production.
4. Save memory `project_creative_remotion_provider_shipped_2026-06-XX.md` with: render time observed, Lambda cost for the first 10 renders, any surprises.
5. Open the Week 2 Cursor prompt (variation matrix + template library UI) once the POC validates.

## Why this scope is correct

- **Single composition, hardcoded.** Forces the integration to actually work end-to-end before we invest in template authoring time.
- **No autotag, no variation loop, no client-facing surface.** Each of those is a real piece of work. Bundling them with the integration POC is how week-1 scope creeps to month-1 scope.
- **Admin-only route.** Trust verification before exposing to producer users.
- **No auto-flag.** Matas validates manually before flipping. Standard discipline for any new external-service integration.
