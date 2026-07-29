# Bird template defects — `throwback_presale_live` (LOG ONLY, DO NOT FIX)

**Found:** 2026-07-29, during the Throwback Monsantos template run.
**Status:** logged, deliberately untouched. Both templates are Meta-**approved**
(`active`), so any edit forces re-submission and a fresh Meta review under
Throwback's live WABA (`1077180327502712`). That is a client-facing publish and
needs Matas's sign-off — it is explicitly out of scope for the run that found it.

Discovered read-only via `listProjects` / `listTemplates`. Nothing was written.

---

## Defect 1 — es-ES button binds the wrong variable

The Spanish button URL interpolates `{{event_artwork_url}}` where it should
interpolate `{{event_url_suffix}}`:

```
es-ES  BTN  "COMPRAR ENTRADAS" → https://ra.co/events/{{event_artwork_url}}
en     BTN  " ACCESS TICKETS"  → https://ra.co/events/{{event_url_suffix}}   ← correct
```

**Effect:** every Spanish-locale `presale_live` send renders a ticket button
pointing at `https://ra.co/events/<the artwork image URL>` — a dead link. The
English button is unaffected.

**Affected (both live, both `active`):**

| Template | Template id | Project | Project id |
|---|---|---|---|
| `throwback_presale_live` | `f7c853aa-a952-414c-9cf2-8f39d2cc03d6` | `throwback_template-presale-live` | `08bab722-597a-41dd-b415-aa256d78325f` |
| `throwback_presale_live_clone` | `203628b8-e346-4c65-a600-2e66d26095e9` | `throwback_template-presale-auto - malaga` | `3cb42761-73d2-4dc7-b464-a98713bcb20b` |

**The repo is already correct.** `lib/d2c/bird/templates/definitions/throwback.ts`
declares a single shared `button.url` of `https://ra.co/events/{{event_url_suffix}}`
across both locales, and the builder emits that same URL for every locale — so
this defect cannot be reproduced from the definitions. It is **drift in Bird**,
almost certainly hand-editing in Bird Studio after the template was shipped.
Re-shipping from the repo would fix it, but the runner's idempotency skips any
template whose name already exists, so a fix needs a deliberate edit or a
re-create under a new name.

## Defect 2 — leading whitespace in the en content

`throwback_presale_live` (`f7c853aa`) only:

```
en  BODY  " Presale is now live for {{event_name}}. Lock in your ticket …"
en  BTN   " ACCESS TICKETS"
                                    ^ leading space in both
```

The repo definitions have no leading space. Same Bird-side drift as defect 1.
Cosmetic, but the button label is Meta-approved *with* the space, so correcting
it also triggers re-review.

---

## Suggested handling

Fold both into one deliberate re-submission when Matas next has appetite for a
Meta review cycle, rather than shipping them piecemeal:

1. Fix es-ES button binding + strip the leading spaces on `f7c853aa`.
2. Decide whether `throwback_presale_live_clone` (Málaga) is still needed at
   all — its `en` slot holds Spanish copy for a *different* event (Málaga,
   19 June) with a raw `chat.whatsapp.com` invite link, i.e. it predates the
   Meta 2388081 approved-domain fix. It looks abandoned.
3. Re-submit and watch `platformInfo` for the new approval status.

Also noted while scanning, not a defect but worth knowing:

- Two legacy `inactive` templates (`Throwback Presale Live` /
  `Throwback Presale Reminder`, projects `21500798…` / `80d0b56f…`) use raw
  `chat.whatsapp.com` button links and Google-Drive-hosted artwork. Their
  `inactive` status is the practical evidence that raw invite links do not get
  approved — which is why the approved-domain redirect
  (`app.offpixel.co.uk/j/…`) is mandatory on all new templates.
- An idle duplicate `draft` of `throwback_autoresp` (`cae2ac54-6242-4396-88a1-43734b2ecdf1`)
  sits alongside the `active` one (`20f8c457-1d96-4d45-99de-1ab7948b1599`) in
  project `e562d41e…`. Harmless, but it means that project already holds a
  draft — Bird permits only one draft per project, so a future re-ship of
  `throwback_autoresp` into it would fail.
