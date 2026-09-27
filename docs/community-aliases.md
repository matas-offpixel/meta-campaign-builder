# WhatsApp community aliases

Stable `/j/{slug}` links for Bird templates and Mailchimp campaigns. When a group fills (~1024 members), repoint the slug at a new invite code. Meta does not re-review the template.

Two hosts serve the same path:

- `https://app.offpixel.co.uk/j/{slug}` — this app. Repoint propagates when the runtime-cache purge lands (normally under a second; see the failure case below).
- `https://crqln.com/j/{slug}` — cirqlin. **Not wired to this repoint yet.** See Decision 2 at the bottom. Until that choice is made, a crqln.com button keeps the interstitial it rendered, up to an hour (`revalidate = 3600`).

## Which column is the invite code

`wa_community_alias_destinations.invite_code` where `is_active` is the code. There is at most one active destination per alias (`uq_wa_community_alias_destinations_one_active`).

`wa_community_aliases.active_invite_code` is a cache of that code. `create_community_alias` and `repoint_community_alias` write both in one transaction. A deferred constraint rejects a commit where they differ.

The public redirect reads the destination row, not the cache.

### Row that disagrees today

`rudimental-nx` (id `c82d0a5a-f25c-49cb-8025-d2051cea4d8c`), read 27 Sep 2026:

| | value |
|---|---|
| alias `is_active` | false |
| `active_invite_code` | null |
| destination `is_active` | true |
| destination `invite_code` | `DdsCUNGsF1RAZlGXkA5L81` (also the active code on `fever105-sheffield`) |
| audit events | none |

The migration does not repair it. The guard does not scan existing rows. A repoint of `rudimental-nx` heals both homes. A notes edit does not touch the invite columns, so it still saves; the ops page shows the disagreement.

## Slug shape

```
^[A-Za-z0-9]+([-.][A-Za-z0-9]+)*$
```

Case-sensitive. Admits the 14 live slugs, `Throwback-Porto-17.10.26`, `Closa-Selects-Barcelona-30.10.26`, and a mixed-case invite code (`[A-Za-z0-9]{20,24}`, and anything else in `[A-Za-z0-9]{8,30}` because the destination check is still 8–30).

Lookup is exact. `Throwback-Porto-17.10.26` and `throwback-porto-17.10.26` are different slugs.

`event_ref` is optional text for an event that should not get a `clients` row.

## Mint at brief intake

Do this when the WhatsApp group is created, alongside the rest of the brief. Do not wait for the template.

```sql
select create_community_alias(
  'Throwback-Porto-17.10.26',   -- slug, case kept
  null,                         -- client_id, or a clients.id
  'Throwback',                  -- brand
  null,                         -- notes
  'XXXXXXXXXXXXXXXXXXXXXX',     -- invite_code (the path segment only)
  'Group 1',                    -- label
  '<operator auth.users id>',  -- actor
  'throwback-porto-17.10.26'    -- event_ref, optional
);
```

The function writes `wa_community_aliases.active_invite_code` and a `wa_community_alias_destinations` row (`alias_id`, `invite_code`, `sort_order` 0, `is_active`) and an audit row.

Column names on the destination table are `alias_id`, `invite_code`, `sort_order`. Not `alias_slug`, `active_invite_code`, or `ordering`.

Put this URL in the new Bird template and the Mailchimp campaign:

```
https://app.offpixel.co.uk/j/Throwback-Porto-17.10.26
```

or, once Decision 2 is settled in favour of crqln staying in sync:

```
https://crqln.com/j/Throwback-Porto-17.10.26
```

Never `https://chat.whatsapp.com/...` in a new template. A raw chat.whatsapp.com button cannot be repointed (task #55). Legacy templates that already point at a raw invite stay as they are.

### Negative cache

A code that was passing through is cached as "no alias" for 300 seconds. Creating the alias purges that tag on the same request, so the new alias is visible immediately when the purge succeeds. If the purge fails, the pass-through can continue for up to 5 minutes. Say so if you mint during a send: hit the URL yourself before the template goes out.

## Repoint

1. Create the new WhatsApp group. Copy the invite code (the path segment, not the full URL — the admin form accepts either).
2. On `/wa-communities`, stage it on the alias and press **Make active**. That calls `repoint_community_alias`, which deactivates the previous destination, activates the new one, updates the cache, and appends a `repointed` audit row in one transaction. The partial unique index does not swap rows by itself; the function deactivates first.
3. The request then expires the runtime-cache tag `alias:{slug}`.

Same call from SQL (service role only):

```sql
select repoint_community_alias(
  'Throwback-Porto-17.10.26',
  'YYYYYYYYYYYYYYYYYYYYYY',
  '<operator auth.users id>',
  'Group 2'
);
```

SQL does not purge the runtime cache. Prefer the admin button. If you used SQL, the old destination can stick for up to an hour (positive TTL 3600s).

### If the purge fails

The row is already repointed. The request retries the purge once. If the retry fails, the API still returns success and `cachePurge: "failed"`. The ops page tells you the previous destination can stick for up to an hour. Nothing is rolled back. Verify before you rely on it:

```bash
curl -sI "https://app.offpixel.co.uk/j/Throwback-Porto-17.10.26"
curl -sI "https://crqln.com/j/Throwback-Porto-17.10.26"
```

Both hosts. `Location` on offpixel should be `https://chat.whatsapp.com/{newCode}?mode=gi_t`. crqln.com will not follow the repoint until Decision 2 is built.

## Fail-open

A database outage, a timeout, or a lookup exception does not 500 the button. A well-formed segment redirects to `https://chat.whatsapp.com/{segment}?mode=gi_t` with the segment bytes unchanged. That includes vanity slugs. A slug is not a WhatsApp code, so during an outage a vanity URL lands on a WhatsApp error page instead of our JSON 404. That is the trade for not breaking an already-approved button.

Anything that is neither a slug nor an invite code is 404.

Unaliased invite codes pass through byte-identical, including `?mode=gi_t`.

## Cirqlin read

`GET /api/community-aliases/{slug}` with `Authorization: Bearer $CIRQLIN_TO_DASHBOARD_BEARER`.

Matas mints the bearer (`openssl rand -hex 32`) and sets the same value on both Vercel projects. Cursor does not hold it.

- Hit: `200` `{ slug, invite_code, effective_destination, interstitial_enabled }`, cached 60s. `interstitial_enabled` defaults false. Cirqlin renders the card only when it is true; otherwise it 302s.
- No alias: `404`.
- Lookup failure or unset bearer: `200` with `invite_code: null` and `degraded: true` (`lookup_failed` or `not_configured`).

Fans cannot tell a miss from an outage: both fail open, and a fail-open during a repoint sends them to the group the button was minted with. If that group is full, they hit the full group. That is accepted on this endpoint. The `degraded` field is how an operator tells the two apart in logs.

Rate limit is 60 requests per minute per IP per isolate.

## Backfill

`scripts/backfill-community-aliases.mjs` prints the candidate rows. It does not write.

Dry run on 27 Sep 2026, events with a WhatsApp group, `event_date >= current_date` or a `scheduled` send still in the future, and no alias on the event slug: **zero rows**. Upcoming events have no `whatsapp_community_url` yet. Do not backfill those. Do not touch approved legacy raw-invite templates.

## Decision 2 — crqln.com is still on a one-hour revalidate

`src/app/j/[code]/page.tsx` in cirqlin is `force-static` with `revalidate = 3600`. `fetchCommunityPreview` keeps a hit for 24h, keyed on the request code.

Offpixel can repoint in under a second. crqln.com keeps sending fans to the interstitial it already rendered for up to an hour. That hour is the failure this work exists to prevent, and the cirqlin change is not in this PR.

Pick one before that repo is built:

- **(a)** Resolve the alias on each cirqlin request. Both hosts repoint together. The page is no longer static.
- **(b)** Keep 3600s. New templates should use `app.offpixel.co.uk`, and the runbook states that crqln.com links are wrong for up to an hour after a repoint.
- **(c)** Shorten cirqlin's `revalidate` and accept the extra load.

Whichever is chosen, cirqlin's propagation needs a test. This PR does not add one, because the page is unchanged.

## Deploy

Apply migration `178_wa_community_alias_repoint.sql` before the app that calls `create_community_alias` / `repoint_community_alias`. Do not apply it on a day with a live D2C send.

The down-migration is in the header comment of that file. It restores `wa_community_aliases_slug_format` to `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'))`. It fails if any slug has gained a capital letter or a dot. It was executed inside a transaction and rolled back on 27 Sep 2026; it was not left applied.
