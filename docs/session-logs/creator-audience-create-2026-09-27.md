[Use Opus]

# Create pixel and customer-list audiences from inside the campaign creator. PR 1 of 2. One PR, `cursor/creator-audience-create`, off fresh `main`. Open, don't merge.

Matas: *"if i want to create a pixel audience or customer list import to updated campaign atm i have to go through the meta platform."*

The app already writes custom audiences — it just does it on surfaces the creator cannot reach:

- `lib/meta/audience-write.ts` `createMetaCustomAudience` (gated by `OFFPIXEL_META_AUDIENCE_WRITES_ENABLED`), with the website-pixel payload keyed on `sourceMeta.subtype = "website_pixel"`, `pixelEvent`, `urlContains[]`, retention (`lib/audiences/bulk-website-types.ts`). Today `BULK_WEBSITE_PIXEL_EVENTS = ["PageView"]` with the comment *"Future: ViewContent, InitiateCheckout, Purchase"*.
- `app/api/meta/customer-audience-upload/route.ts` — creates a `CUSTOM` / `USER_PROVIDED_ONLY` audience and POSTs SHA256 email/phone rows to `/{id}/users`, chunked. UI at `/clients/[id]/customer-audience` (`customer-audience-wizard.tsx`).
- The creator's Audiences tab (`components/steps/audiences/`) only picks from `GET /api/meta/custom-audiences`.

**This PR does not add a third way to create audiences.** It puts the two existing writers behind a "+ New audience" control on the Audiences tab and makes the result land in the draft.

## 1 — Pixel events: full funnel

Extend `BULK_WEBSITE_PIXEL_EVENTS` to `PageView, ViewContent, InitiateCheckout, Purchase, Lead, CompleteRegistration`, with labels. The matrix builder grows rows for free — the type comment says so; confirm the rule payload in `audience-payload.ts` handles a non-PageView event without special-casing (it should be `event_name` in the rule filter). `urlContains` and retention (≤180) unchanged. Run one live create per new event on a test pixel and paste the returned rule in the PR body — do not assume Meta accepts the event names the way the app spells them.

## 2 — "+ New audience" on the Audiences tab

Two entries: **Website (pixel)** and **Customer list**. Each opens a panel inside the drawer, not a route change — the operator is mid-draft.

- **Pixel:** pixel picker (the draft's ad account's pixels — `GET /api/meta/pixels` exists), event, retention, optional URL contains, name (default from `lib/audiences/naming.ts`'s convention so it matches what the builder would call it). Submit → `createMetaCustomAudience` with the same insert shape `bulk-website` writes, so the audience also shows in the builder's list and `meta_custom_audiences`.
- **Customer list:** CSV/paste of emails and/or phones, the same normalisation and hashing the customer wizard uses (move it to `lib/` if it is inline in the component; do not copy it), name, then the existing upload route. Show the match-schema and row count before submit.
- Both gated by `OFFPIXEL_META_AUDIENCE_WRITES_ENABLED === "true"` exactly as the builder pages are; when off, the control renders disabled with the same message.

## 3 — The new audience lands in the draft

On success, add it to the draft's current custom audience group (or a new group if none is selected), with the returned Meta id and name, and a **populating** badge — Meta takes minutes to hours to fill a pixel audience and a customer list. Do not poll. `lib/audiences/adset-create-with-salvage.ts` already handles a populating CA at launch (#756); confirm the new id goes through that path and say so.

The audience also appears in the picker's list on next open without a manual refresh — invalidate whatever cache `GET /api/meta/custom-audiences` sits behind for that account.

## Guards

No migration if `meta_custom_audiences` already carries what the builder inserts — check. Writes go through the existing writers only; a grep for `customaudiences` under `components/` must find zero new call sites. Do not touch the lookalike, page, or video builders, `lib/tiktok/**`, `lib/optimisation/**`, `lib/google-ads/**`, `lib/google-search/**`. Nothing in this PR writes to an ad set — that is PR 2.

## Test plan

Pixel create with `Purchase` / 180d / URL contains produces the rule the live test returned. Each of the six events builds a valid rule. Customer list with 3 emails + 2 phones hashes and chunks as the wizard does — assert against the wizard's existing test. Created audience is in the draft's group with the `populating` badge and the right id. Gate off → control disabled, no network. The builder's own pages unchanged (their tests green).

Full `npm test`, `npm run build`, check-run conclusions in the thread — not in a commit.
