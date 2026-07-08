# Session log

## PR

- **Number:** 699
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/699
- **Branch:** `cursor/d2c-dashboard-live-test-bugfixes`

## Summary

Bundles four bugs surfaced live-testing PRs #697/#698 against the Throwback
Algarve event: (A) WhatsApp test-send sent an empty body → Bird `422`
because the route read a `result_jsonb.bodyMarkdown` field that never
existed; (B) WhatsApp sends silently downgraded from the approved-template
path to the empty body-text path because the Bird provider only looked for
template identity on `audience`, not `variables` (this also broke the real
webhook/poll autoresponder fire path, not just test-send); (C) the
multi-tag audience picker 404'd on Mailchimp because `GET /lists/{id}/tags`
does not exist in the v3 API — the correct endpoint is
`GET /lists/{id}/segments?type=static`; (D) real/test emails rendered as
plain text with no artwork, CTA button, or branded chassis because
`mailchimp/provider.ts` shipped bare `markdownToBasicHtml(bodyMd)` instead
of the rich HTML the dashboard preview showed.

## Scope / files

- `lib/d2c/render/email-html.ts` (new) — `renderD2CEmailHtml`, extracted
  from `SendPreview`'s email branch; single source of truth for preview +
  real/test Mailchimp campaign HTML (Bug D).
- `lib/d2c/mailchimp/provider.ts` — `sendMailchimpCampaignLive` now renders
  via `renderD2CEmailHtml` (Bug D) and resolves the list id via
  `resolveMailchimpListId` (Bug C).
- `lib/d2c/audience/tag-registry.ts` — `getAudienceTags` now hits
  `/lists/{id}/segments?type=static` instead of the non-existent
  `/lists/{id}/tags`; added `resolveMailchimpListId` (Bug C).
- `app/api/d2c/scheduled-sends/[id]/audience-tags/route.ts` — GET now uses
  `resolveMailchimpListId` (Bug C).
- `lib/d2c/bird/provider.ts` — added `resolveBirdTemplateInfo`, which reads
  template identity from both `audience` and `variables` (audience wins),
  fixing `isTemplateSend` for both test-send and the real webhook/poll fire
  path (Bug B).
- `lib/db/d2c.ts` — added `getD2CTemplateButtonInfo` to read button
  label/url out of `d2c_templates.variables_jsonb` for the email test-send
  branch (Bug D).
- `app/api/d2c/scheduled-sends/[id]/test-send/route.ts` — WhatsApp branch
  now resolves body content via `resolveTestSendContent` off
  `d2c_event_copy`/`d2c_templates` instead of the nonexistent
  `result_jsonb.bodyMarkdown` (Bug A), and copies resolved Bird template
  info onto its ephemeral `audience` (Bug B); email branch now passes
  artwork/eventName/button fields through to `sendMailchimpCampaignLive`
  (Bug D).
- `lib/d2c/types.ts` — `D2CMessage` gained optional email-only render
  inputs (`artworkUrl`, `eventName`, `buttonLabel`, `buttonUrl`,
  `themeColor`), ignored by non-email providers.
- `components/dashboard/d2c/send-preview.tsx` — email branch now calls
  `renderD2CEmailHtml` directly (via `dangerouslySetInnerHTML`) instead of
  a bespoke Tailwind mockup, so preview and send are byte-identical.
- Tests: new `lib/d2c/render/__tests__/email-html.test.ts` (11 cases);
  extended `lib/d2c/bird/__tests__/provider.test.ts` (variables-path
  template resolution + a live-send regression test),
  `lib/d2c/audience/__tests__/tag-registry.test.ts` (`resolveMailchimpListId`
  + `getAudienceTags` against the corrected endpoint), and
  `lib/d2c/__tests__/mailchimp-provider.test.ts` (branded-HTML + audience_id
  fallback regression tests). Fixed `lib/d2c/mailchimp/__tests__/provider-segment-opts.test.ts`'s
  fetch stub, which mocked the old (incorrect) `/tags` endpoint and broke
  once `getAudienceTags` was corrected to hit `/segments?type=static`.

## Flagged, not fixed (per spec)

Historical `d2c_scheduled_sends.audience` rows use `audience_id`; PR #696's
tag picker + PATCH route write `list_id`. `resolveMailchimpListId` reads
both (list_id wins) as a read-side normalisation, but the PATCH write path
still writes only `tags`, not a canonical list-id key. Follow-up: migrate
the write path to canonicalize on `list_id` and backfill historical rows.

## Validation

- [x] `npx tsc --noEmit` — no new errors (pre-existing unrelated errors in
      `lib/clients/asset-queue`, `lib/dashboard`, `lib/meta` test files
      untouched by this PR).
- [x] `npm run build` — succeeds.
- [x] `npm test` — 2960/2975 pass. The 14 failures are pre-existing on a
      clean `main` checkout (asset-queue copy-generator/sheet-parse,
      dashboard trend-point/smoothing tests, canonical-tickets-window,
      creative-buy-tickets-cta, batch-fetch-video-metadata — all unrelated
      to D2C). Verified via `git stash` before committing.
- [x] `npm run lint` — zero errors/warnings on every file this PR touches
      (scoped lint run); pre-existing errors elsewhere (`lib/hooks/useMeta.ts`,
      `send-preview-modal.tsx`, etc.) are untouched by this PR.

## Notes

Not self-merging — the email-render extraction (Bug D) is user-visible and
the user asked to leave this open for review + a live browser check of the
actual test email in `matt.liebus@gmail.com`, plus the 5-step
post-implementation verification against the Throwback Algarve dashboard
(WA template test-send, tag picker, tag persistence, and both EMAIL cards'
branded-chassis rendering).
