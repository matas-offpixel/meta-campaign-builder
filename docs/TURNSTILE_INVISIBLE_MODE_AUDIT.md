# Turnstile invisible-mode audit — OP909 Phase 9 (2026-07-05)

Why does the Turnstile widget still show up for some fans on the
landing pages even though the code passes `appearance:
"interaction-only"`? Short answer: **the code is correct; the sitekey's
Widget Mode at Cloudflare is (almost certainly) "Managed", and Managed
mode escalates to a visible interactive challenge whenever Cloudflare
distrusts the visitor.** The fix is a Cloudflare dashboard change, not a
code change.

## 1. What the implementation does today (verified)

- Sitekey: `0x4AAAAAADvl7YKglAoGMhcl` — same value in local
  `.env.local` and live prod (read out of the deployed
  `/l/gmc-worldwide-productions/jackies-…` page HTML on 2026-07-05).
- Rendering: explicit mode. `signup-form.tsx` loads
  `api.js?render=explicit` and calls `window.turnstile.render(container,
  { sitekey, appearance: "interaction-only", … })` into an unstyled div
  under the sign-up button. Verified the deployed prod bundle contains
  `interaction-only` (grep of `/_next/static/chunks/*.js` served by
  app.offpixel.co.uk), so the param is definitely reaching production.
- Execution: default (`execution: "render"`) — the challenge runs as
  soon as the widget renders, not on submit.
- Server side: `verifyTurnstile` posts the token to `siteverify`;
  failure → 403 before any DB work; missing keys → dev bypass unless
  `LANDING_PAGES_TURNSTILE_REQUIRED=1`; Cloudflare unreachable → fail
  open (logged).

## 2. Live behaviour observed (prod, clean desktop Chrome)

Loaded the live Jackies Mallorca page and inspected the DOM via
DevTools protocol:

- **No iframe was created at all** — the Turnstile host div renders at
  height 0 and contains only the hidden
  `input#cf-chl-widget-…_response`.
- **A valid token (858 chars) was minted silently** into that input a
  moment after page load, with zero visible UI.

So for a visitor Cloudflare trusts, `interaction-only` already behaves
fully invisibly, end to end. The widget people see is the OTHER branch:
when Cloudflare's risk engine decides it wants interaction, the iframe
appears with the checkbox/"Verify you are human" box.

## 3. Why the widget still becomes visible

Only **Managed** widget mode ever issues interactive challenges. Per
Cloudflare's docs, `appearance: "interaction-only"` means "keep the
widget invisible **unless an interactive challenge is issued**" — it
controls visibility timing, not whether interaction can happen. The
three Widget Modes:

| Widget Mode | Can show interactive challenge? | UI with `interaction-only` |
|---|---|---|
| Managed | YES — at Cloudflare's discretion | Hidden until CF escalates, then visible checkbox |
| Non-interactive | No, but shows a passive spinner/badge | Hidden (no interaction ever required) |
| Invisible | Never — no UI at all, ever | None (appearance param is moot) |

Our fan traffic skews heavily to Instagram/TikTok in-app webviews on
mobile (that is the whole ad funnel) — exactly the low-reputation,
heavily-fingerprint-blocked environments where Managed mode escalates
most often. That matches the reports: some fans see the box, a clean
desktop browser doesn't.

Note on certainty: Cloudflare exposes no public API to read a sitekey's
Widget Mode (`siteverify` with a dummy token just returns
`invalid-input-response` regardless, and the widget type is not in the
`api.js` payload). The evidence is behavioural — silent minting on a
trusted browser (rules out "always visible" misconfig) plus real
visible-challenge sightings (rules out Invisible/Non-interactive, which
never issue interactive challenges). Only Managed produces both.

## 4. The fix — Cloudflare dashboard (Matas, ~1 minute)

1. Cloudflare dashboard → account home → **Turnstile**.
2. Open the widget whose sitekey is `0x4AAAAAADvl7YKglAoGMhcl`.
3. **Settings → Widget Mode → select "Invisible" → Save.**
   (Widget Mode is editable in place; the sitekey/secret do not change,
   so no env var updates and no deploy are needed.)
4. While there, review **Allowed hostnames**: `app.offpixel.co.uk` must
   stay; adding `localhost` would silence the 110200 error seen during
   local dev (optional — see §6).

No code change is required. `appearance: "interaction-only"` is simply
ignored for an Invisible-mode widget; token minting and the
`callback`/`expired-callback` flow are identical.

## 5. Trade-off to sign off before flipping

Managed mode gives suspicious-but-human visitors an interactive rescue
path (tick the box, pass, sign up). Invisible mode removes that path:
a visitor whose environment fails the invisible challenge mints no
token (or a failing one) and the API returns 403
(`missing_captcha_token` / `captcha_rejected:…` in Vercel logs).

- Mitigation already in place: `error-callback` clears the token and
  the form still submits; the server's 403 message asks the fan to try
  again; siteverify outages fail open.
- Recommendation: flip to Invisible, then watch Vercel logs for a spike
  in `[landing-pages] captcha failed` during the next presale push. If
  legit fans are being rejected, flip back to Managed (same 1-minute
  dashboard toggle, no deploy) — or consider Non-interactive as the
  middle ground (never blocks with a puzzle, shows only a brief passive
  badge).

## 6. Optional code-side alternatives (NOT recommended now)

- `execution: "execute"` + `turnstile.execute()` on form focus/submit
  would defer the challenge until the fan interacts, shrinking the
  window in which a Managed-mode box can pop in. It does not eliminate
  visible challenges, adds submit-time latency for everyone, and is
  pointless once the widget is Invisible-mode. Skip.
- Local-dev hostname: the widget currently 110200s on `localhost`
  (observed during Phase 4 verification), so local work uses the
  unset-keys dev bypass. Either add `localhost` to Allowed hostnames or
  keep using the bypass / Cloudflare's dummy test keys
  (`1x00000000000000000000AA` pass / `2x00000000000000000000AB` block)
  in `.env.local`. No strong preference.

## 7. Verification plan after Matas flips the mode

1. Open the live LP in a normal browser — confirm signup still works
   and no widget appears (same as today for trusted browsers).
2. Open it in an Instagram in-app webview (ad preview → view website) —
   previously the escalation-prone path; confirm no checkbox appears
   and signup succeeds.
3. `SELECT count(*) FROM event_signups WHERE created_at > <flip time>`
   sanity check after a day, plus a scan of Vercel logs for
   `captcha failed` frequency.
