# Session log

## PR

- **Number:** 1084
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1084
- **Branch:** `cursor/creative-lab-m3b`

## Summary

An approved Creative Lab round can be launched paused from the event page. The launch route returns 503 until `CREATIVE_LAB_LAUNCH_ENABLED` is exactly `true`, and that flag is not set. Ads are created paused. There is no auto-launch, no auto-pause, no ACTIVE attach path, no TikTok round, no static, and no overlay emoji.

Matas approved the long caption size on 6 Nov 2026. `longApproved` is `true` in `src/remotion/caption-style/v1.json`. The style hash is still `4a9ddd841764b7a5296f522081afc7af816fd6dabc87a0c869f43c55f94e69e5`. `versionedProfile` drops `longApproved` before hashing, and `long.source` was not edited, so the hash does not move. Existing `creative_lab_captions.style_version` stamps were left as they are. Captions written after this change receive the same hash.

## Scope / files

- `lib/creative-lab/launch.ts`, `lab-draft.ts`, `killswitch.ts` — in-memory attach draft, `createPaused: true` in one function, killswitch before upload or Graph.
- `app/api/creative-lab/rounds/[id]/launch/route.ts` — 503 before auth or a service client when the flag is off. `maxDuration` 800.
- `lib/creative-lab/caption-facts.ts`, `writer.ts`, `past.ts` — past appearances need a recorded show; Pick one is 2–3 different upcoming nights.
- `lib/db/creative-lab.ts`, `components/dashboard/events/creative-lab-card.tsx`, event page — collapsed Creative Lab card.
- `lib/creative-lab/card-write.ts`, `judge-round.ts`, `app/api/creative-lab/events/[eventId]/route.ts` — facts, artists, clips, captions, propose, approve, judge. Judge writes verdicts only. It does not pause.
- `CLAUDE.md` — `CREATIVE_LAB_LAUNCH_ENABLED`. Not set in Vercel or `.env`.

## Validation

- [x] `npx tsc --noEmit` on the files in this PR (repo-wide `tsc` still reports pre-existing Jest errors outside this change). `next build` typecheck passed.
- [x] `npm run build`
- [x] `npm test` — 7586 node tests plus 8 vitest, 0 failures.

## Notes

- "Sunday 27 December" is 18 characters, so it stays on one line at the default width. The weekday splits off at 17. "27 December" stays together at 18.
- Production read of P26-BDAY-DAY (`d2fa91e6-b245-4064-8a20-402a8c0a4dd1`), 6 Nov 2026, flag unset: facts are Enzo Siragusa, Luke Dean, Reeshy, Phill de Janeiro, Benji King; headliners the first three; allowed date 2026-12-27. Luke Dean (`fe3736d8-4252-4282-bb32-de1e3fdfb359`) is "recorded, not approved (PENDING: Luke Dean team)". `approved_at` is still null. Zero rounds. Next payday Friday, 27 November 2026. 51 days to the event. The launch button text is "Lab launches are switched off".
- Generate wrote three `lineup` captions as `proposed`, size `long`, stamped with the hash above: `e2127a1b-471e-4d49-90f5-bac29d243497`, `fd60b036-6b8c-4a3d-838b-d779f0af9677`, `9053cf86-f894-4753-9e86-50cccfc76790`.
- `proposeRound` for Luke Dean returned `not_approved` ("permission stored but not approved") and inserted no round.
- `postLabLaunch` returned 503 `{ error: "Lab launches are switched off" }` and did not upload or call Meta.
- The event page itself was not opened in a browser. This branch is not deployed, and the page needs an operator session. The card data above is what that page loads.
