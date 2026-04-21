# 4TheFans native API onboarding

The 4TheFans-native ticketing adapter is scaffolded behind the
`FEATURE_FOURTHEFANS_API` flag. This page is the checklist Matas runs
when 4TheFans publish their API docs.

## TL;DR

The provider is already registered in `lib/ticketing/registry.ts` and
the dashboard already lets users select "4TheFans" when adding a
connection. With the flag off (default), every connection attempt and
every sync errors with a clear "pending API release" message. Flipping
the flag lets credential storage flow through to the adapter, which
will throw a TODO error until the methods are filled in.

## Step 1 — Receive 4TheFans API docs

Get from 4TheFans:

1. **Base URL** — production + staging if available.
2. **Auth model** — confirm bearer token. If they ship OAuth, this doc
   needs an addendum (see "OAuth follow-up" below).
3. **Identity endpoint** — the equivalent of `/users/me`. Used to
   validate credentials and grab the account id.
4. **List events endpoint** — paginated, accepts the account id (or
   filters server-side based on the token's owner).
5. **Per-event sales endpoint** — returns at least: tickets sold,
   tickets available (capacity), gross revenue, currency.
6. **Error envelope** — JSON shape on non-2xx responses (e.g. does
   `{ message: "..." }` exist? `{ error: { code, detail } }`?).

## Step 2 — Update the env files

In `.env.local` (and the production env in Vercel):

```
FEATURE_FOURTHEFANS_API=true
FOURTHEFANS_API_BASE=https://api.4thefans.tv/   # or whatever staging URL
```

Restart the dev server / redeploy.

## Step 3 — Implement the adapter

All edits live in `lib/ticketing/fourthefans/`:

### `client.ts`
- Update `DEFAULT_API_BASE` to the confirmed production URL.
- If 4TheFans returns errors with a different envelope, update the
  body parsing block in `fourthefansGet` to extract their actual
  message field.

### `provider.ts`
Replace each TODO block:

1. `validateCredentials` — point the request at the real identity
   endpoint and update the response shape destructuring. Persist the
   correct field as `externalAccountId`.
2. `listEvents` — replace the `throw new FourthefansDisabledError(...)`
   with the real call. Map their event shape onto `ExternalEventSummary`:
   - `externalEventId` ← their event id (always coerce to string)
   - `name` ← their title
   - `startsAt` ← ISO start time (null if unknown)
   - `url` ← public event URL
   - `status` ← optional status hint
3. `getEventSales` — replace the throw. Map onto `FetchedTicketSales`:
   - `ticketsSold` ← integer
   - `ticketsAvailable` ← integer or null when capacity isn't exposed
   - `grossRevenueCents` ← convert their amount into integer pennies
   - `currency` ← ISO 4217 (default to `null` if not provided)
   - `rawPayload` ← the entire response (debugging)

### `types.ts`
If the credentials shape isn't `{ access_token: string }`, update the
docstring near `TicketingConnection.credentials` so the next reader
knows what's there.

## Step 4 — Test

1. `npm run lint && npm run build` — must stay green.
2. From `/clients/[id]/settings`, add a 4TheFans connection with a
   valid token. Expect: green success state, account id stored.
3. Try a bad token. Expect: friendly error, no DB row.
4. Link a known event from `app/api/ticketing/events?connectionId=X`.
5. Hit `POST /api/ticketing/sync?eventId=X` and verify a
   `ticket_sales_snapshots` row was written.
6. Hit `/api/cron/sync-ticketing` (Task E) with the cron secret to
   confirm the connection is included in the nightly batch.

## OAuth follow-up

If 4TheFans publish OAuth instead of personal tokens, the work is:
- Add a `4thefans-callback` route under `app/auth/` mirroring the
  existing Facebook OAuth path.
- Replace the "paste token" UI in
  `components/dashboard/clients/ticketing-connections-panel.tsx` with
  a "Connect with 4TheFans" button that kicks off the OAuth flow.
- Persist refresh tokens on the connection row and add a refresh step
  to the cron in Task E.

That's a separate PR — don't try to fold it into the spec implementation.
