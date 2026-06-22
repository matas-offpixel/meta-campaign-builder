# Session log

## PR

- **Number:** pending
- **URL:** {GitHub PR URL when known}
- **Branch:** `cursor/mailchimp-end-to-end-opus`

## Summary

Completes the bulletproof Mailchimp tag-tracking architecture started in PR #630.
The classic webhook UI never exposed a "tag added" trigger, so PR #630's webhook
layer was unreachable. This PR makes all three layers work end-to-end. The
**primary real-time path is the classic Profile-updates webhook**: on every fire,
`handleProfileUpdate` re-fetches the member's tags and diffs against the event
log, reading Mailchimp as the source of truth. (Customer Journey "Make API call"
was evaluated and rejected — journey starts under-report tag adds, measured 4,230
vs 4,559 segment members — though the handler still parses the JSON shape if one
is ever wired up.) The EOD `member_count` cron is the daily backstop and backfill
auto-fires whenever an event gains a `mailchimp_tag`. A `webhook-url` helper
endpoint surfaces the exact classic-webhook URL + auth.

## Scope / files

- `app/api/webhooks/mailchimp/[clientId]/[audienceId]/route.ts` — primary
  profile-update self-correction path (classic webhook); also parses form
  `tag_added`/`tag_removed` and JSON bodies if present; Bearer-token auth added to
  `isTrusted` (alongside query secret + HMAC); GET verification now validates the
  client/audience exists.
- `lib/mailchimp/tag-tracking.ts` — new `handleProfileUpdate` (re-fetch tags,
  diff against event log, write missing add/remove rows, recompute snapshots) and
  `maybeTriggerTagBackfill` fire-and-forget helper.
- `lib/mailchimp/client.ts` — new `getMemberTags` (full member tag list).
- `app/api/events/[id]/mailchimp/webhook-url/route.ts` — NEW, session-authed;
  returns canonical webhook URL + Bearer/query auth + classic Profile-updates
  setup instructions.
- `app/api/cron/mailchimp-eod-snapshot/route.ts` — per-run, per-audience segment
  cache so events sharing one audience don't refetch segments.
- `app/api/events/route.ts` + `app/api/events/[id]/route.ts` — auto-fire backfill
  when an event is created with, or PATCHed to set, a `mailchimp_tag`
  (`mailchimp_tag` added to the PATCH whitelist).
- `scripts/run-mailchimp-tag-backfill.mjs` — NEW convenience driver: start +
  poll `/status` for one or more events.
- `CLAUDE.md` — corrected webhook-setup docs (Customer Journey primary path).

## Validation

- [x] `npx tsc --noEmit` (no new errors in touched files; pre-existing
  `.next/dev/types/validator.ts` + jest test-file noise unchanged)
- [x] `npm run build`
- [x] `npx eslint` on touched files (clean)

## Notes

- No schema change — reuses PR #630's migration 119.
- `webhook-url` is intentionally session-auth only (no Bearer path) so the secret
  is never echoed to cron callers.
- Generated `lib/db/database.types.ts` is stale (no `mailchimp_*` columns), so
  `mailchimp_tag` writes use loose-cast payloads — same pattern as existing reads.
- Post-merge ops: set `MAILCHIMP_WEBHOOK_SECRET` in Vercel, enable the classic
  Profile-updates + Email-changed webhook per audience (Ironworks first), then fire
  the one-time backfills for IRWOHD + Camelphat. Customer Journeys are not used —
  they under-report tag adds.
