# Session log — PR #356

## PR

- **Number:** 356
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/356
- **Branch:** `creator/audience-source-fetch-defensive-json`

## Summary

Audience source client helpers no longer call `res.json()` blindly. Responses are read as text, parsed with try/catch, and non-JSON bodies (Vercel 504 HTML, plain-text errors) return structured `{ ok: false, error, rateLimited }` messages instead of throwing JSON parse errors in the UI.

## Scope / files

- `lib/audiences/source-picker-fetch.ts` — `fetchAudienceSourceList` + `fetchAudienceCampaignVideos`: text-first → JSON.parse with timeout/heuristic messaging
- `lib/audiences/__tests__/source-picker-fetch.test.ts` — mocked `fetch` scenarios

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] `npx eslint` (scoped)
