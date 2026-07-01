# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `d2c/wa-community-button-redirect`

## Summary

Meta twice rejected 4 Bird WhatsApp templates (`jackies_autoresp`,
`jackies_presale_reminder`, `throwback_autoresp`, `throwback_presale_reminder`)
with `error_subcode 2388081` because their community-invite button URL was
variable (`https://chat.whatsapp.com/{{wa_community_invite}}`) — Meta can't
validate a variable URL at review time. Fix: route the button through a
static, approved domain (`https://app.offpixel.co.uk/j/{{wa_community_invite}}`)
that 302-redirects to the real `chat.whatsapp.com` invite. Deleted and
re-created all 4 templates with the new URL and submitted them to Meta.

## Scope / files

- `app/j/[invite]/route.ts` — new public GET route. Validates
  `/^[A-Za-z0-9]{8,30}$/`, 302s to `https://chat.whatsapp.com/{invite}?mode=gi_t`,
  logs `[d2c wa-community-redirect] { invite, userAgent, referer }`.
- `lib/auth/public-routes.ts` — added `/j/` to `PUBLIC_PREFIXES` (route has no
  user data behind it; validates the invite code itself).
- `lib/d2c/bird/templates/definitions/jackies.ts`,
  `lib/d2c/bird/templates/definitions/throwback.ts` — `autoresp` +
  `presale_reminder` button URLs changed from `chat.whatsapp.com/{{wa_community_invite}}`
  to `app.offpixel.co.uk/j/{{wa_community_invite}}`. `presale_live` (ra.co URL)
  untouched. Variable name unchanged.
- `lib/d2c/bird/templates/runner.ts`, `scripts/d2c/ship-bird-templates.ts` —
  added a `--delete` flag (`deleteBrandTemplates`): resolves each template's
  one-project-per-template layout and calls the existing `deleteTemplate`
  client function. Missing project/template is a no-op skip, not an error.

## Live actions taken (Bird API, production workspace)

Deleted the 4 rejected templates, then re-created + submitted (`--submit`) each
with the new button URL. All transitioned `draft` → `pending` immediately
(Meta's 24-48h review clock started):

| Template | New Bird template id | Project id |
|---|---|---|
| `jackies_autoresp` | `7f913243-a9ca-4485-b0bd-0e4c13302375` | `53b26928-1df2-4d7a-a40a-8a92abc44429` |
| `jackies_presale_reminder` | `ecd6084b-6441-4690-b77c-382e02240c98` | `11b72edc-6f62-45f6-9f0c-c2b056610779` |
| `throwback_autoresp` | `20f8c457-1d96-4d45-99de-1ab7948b1599` | `e562d41e-444f-431e-867b-55f1c27a9a91` |
| `throwback_presale_reminder` | `756748c4-26f9-4fa4-af74-0d9361828159` | `e166823c-1084-4831-acd1-a22d0fa87a73` |

## Validation

- [x] `npm run build` — succeeds; `/j/[invite]` registers as a dynamic route.
- [x] `npm run lint` — 115 problems (20 errors, 95 warnings), identical to the
      `main` baseline; none in the files this PR touches.
- [x] Local dev server: `curl localhost:3000/j/BEkbaKi9HUS3Tjl1ULBbe1` → `302`
      to `https://chat.whatsapp.com/BEkbaKi9HUS3Tjl1ULBbe1?mode=gi_t`;
      short/invalid invite codes → `400`.

## Notes

- **Cross-thread ask for Ops:** `CLAUDE.md`'s routes table (in the "Routes"
  section) should add a row for `/j/[invite]` — public WhatsApp community
  redirect for Bird template buttons. Not edited here per dashboard/thread
  boundaries; flagging for Ops to pick up.
- No npm deps added. No Ops-owned files edited.
- No auto-merge — Matas reviews and merges.
- Meta's approval clock is 24-48h; the `pending` status above is the
  immediate post-submit read, not a final approval. Worth a follow-up check
  in ~48h (or a Bird Studio glance) to confirm `active`/`whatsapp_approved`
  and catch a possible second rejection if `app.offpixel.co.uk/j/` itself
  becomes the objection this time.
