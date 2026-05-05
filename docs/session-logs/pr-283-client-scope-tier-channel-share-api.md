# Session log: client-scope tier-channel share API fix

## PR

- **Number:** 283
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/283
- **Branch:** `fix/client-scope-tier-channel-share-api`

## Summary

Fixes the Multi-Channel Ticket Entries error on client-scope venue share
URLs such as `/share/client/E8bYmoAxttBNWy3o/venues/WC26-BRIGHTON`.
The mounted `apiBase` included `/tier-channels` while the card also
appended `/tier-channels`, producing a 404 HTML response and the
`Unexpected token '<'` JSON parse error. After that URL is corrected,
the venue share APIs now also accept client-scoped tokens when the
request includes an event anchor that belongs to the client share.

## Scope / files

- `components/share/venue-full-report.tsx` — pass the API root
  (`/api/share/venue/[token]` or `/api/events/[id]`) instead of the
  nested `/tier-channels` path.
- `components/dashboard/events/multi-channel-ticket-entry-card.tsx` —
  include `event_id` on share reads so client-scope tokens can resolve
  the current venue group.
- `lib/db/share-token-venue-write-scope.ts` — allow venue APIs to
  resolve either venue-scope tokens or client-scope tokens with an
  event anchor, preserving owner/client checks and `can_edit`.
- `app/api/share/venue/[token]/tier-channels/*` and
  `app/api/share/venue/[token]/budget/route.ts` — pass the request's
  event id into token resolution so reads/writes work from client
  share venue subpages.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint` on modified files

## Notes

`assertVenueShareTokenWritable` still rejects unrelated client tokens:
the supplied event id must belong to the share's `client_id` and the
share owner. View-only shares can read but still return `can_edit=false`
so the card remains read-only.
