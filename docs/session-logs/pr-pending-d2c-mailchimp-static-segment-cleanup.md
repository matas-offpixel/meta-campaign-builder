# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/d2c-mailchimp-static-segment-cleanup`

## Summary

Matas flagged orphan `d2c-test-<timestamp>` entries accumulating in
Throwback's Mailchimp audience (`c2b4d77acb`) Tags panel, from the
member-of-1 mechanism PR #697/#698 built for the webhook autoresponder and
"send test to me".

**Spec correction (root cause differs from the ask's hypothesis).** The ask
assumed the pollution came from a tag-based helper (`POST /lists/{id}/tag-
search` or `POST /lists/{id}/members/{hash}/tags`) and prescribed switching
to `POST /lists/{id}/segments` with a `static_segment` array. That's
**already** exactly what PR #697/#698 built
(`lib/d2c/mailchimp/ephemeral-segment.ts:createMemberSegment`) — both
consumers (`lib/d2c/autoresp/fire.ts`, the test-send route) already call
this segment-based helper, not a tag endpoint. Implementing the ask
verbatim would have changed nothing, because the actual bug is one level
deeper: **Mailchimp merged "static segments" into "tags" years ago.** The
`/segments` endpoint still uses the name "static segment" internally, but
every one created with a `static_segment` array is rendered in the modern
UI's Audience → **Tags** panel, not Segments — this repo's own
`lib/d2c/audience/tag-registry.ts` already documents exactly this ("a tag
IS a static segment sharing the same id space") and enumerates tags via
`GET /lists/{id}/segments?type=static`. Confirmed against three independent
sources (Mailchimp's own developer guide + two Stack Overflow threads) that
this is a known, permanent characteristic of the v3 API, not a version-
specific quirk.

**Actual fix:** swap `createMemberSegment` from a `static_segment` array to
a **saved** (query-based) segment — a single `EmailAddress` condition
(`condition_type: "EmailAddress", field: "merge0", op: "is", value: email`)
matching exactly the target member. Saved segments are a distinct
Mailchimp segment `type` from static segments/tags and never surface in the
Tags UI. No downstream change was needed:
`recipients.segment_opts.saved_segment_id` on the campaign-create call
(`sendMailchimpCampaignLive` in `lib/d2c/mailchimp/provider.ts`) already
works identically regardless of whether the referenced segment is static or
saved — Mailchimp resolves segment membership at send time either way.

## Scope / files

- `lib/d2c/mailchimp/ephemeral-segment.ts` — `createMemberSegment`'s POST
  body changed from `{ name, static_segment: [email] }` to
  `{ name, options: { match: "any", conditions: [{ condition_type:
  "EmailAddress", field: "merge0", op: "is", value: email }] } }`. Rewrote
  the module doc comment to explain the static-segment-is-a-tag fact and
  why the saved-segment fix resolves it. `deleteSegment` is unchanged (the
  delete endpoint is identical for both segment types) — kept as a
  best-effort cleanup even though a leaked saved segment is now invisible
  in the Tags UI regardless (defence in depth, not a mis-send risk either
  way).
- `lib/d2c/mailchimp/__tests__/ephemeral-segment.test.ts` (new) — 5 cases,
  byte-diffing the exact POST body against the expected saved-segment shape
  (asserting `static_segment` is never a key on the request), covering both
  the `d2c-test` (test-send) and default `d2c-autoresp` (webhook) name
  prefixes, plus 2 cases for `deleteSegment` (happy path + best-effort
  swallow on a failed delete).
- Both existing consumers (`app/api/d2c/scheduled-sends/[id]/test-send/route.ts`,
  `lib/d2c/autoresp/fire.ts`) needed **no changes** — they already call
  `createMemberSegment`/`deleteSegment` by name; the fix is entirely inside
  the helper.

## One-time cleanup for existing pollution

There's no SQL for this — the polluting tags live in Mailchimp, not our
Postgres DB (we don't persist ephemeral segment ids/names anywhere; the
audit trail in `d2c_autoresp_fires.result_jsonb` only stores the campaign/
content/schedule response, not the segment that was deleted before that
point). Two ways to clear the existing `d2c-autoresp-*` / `d2c-test-*`
orphans from Throwback's audience `c2b4d77acb`:

**Mailchimp UI (easiest for Matas):** Audience → Tags → search `d2c-` →
select all matches → bulk delete.

**Mailchimp API** (equivalent, using Throwback's own API key):

```bash
# List every tag/static-segment matching the ephemeral naming convention
curl -s -u "anystring:$MAILCHIMP_API_KEY" \
  "https://us7.api.mailchimp.com/3.0/lists/c2b4d77acb/segments?type=static&count=1000" \
  | jq '.segments[] | select(.name | startswith("d2c-")) | {id, name}'

# Delete each one by id
curl -s -u "anystring:$MAILCHIMP_API_KEY" -X DELETE \
  "https://us7.api.mailchimp.com/3.0/lists/c2b4d77acb/segments/<id>"
```

Going forward, no new `d2c-*` tags will be created at all — the fix in this
PR means every future ephemeral segment is a saved segment, invisible in
the Tags panel from creation, so this cleanup is a one-time historical
catch-up, not an ongoing task.

## Validation

- [x] `npx tsc --noEmit` — 439 errors before and after (identical count on a
      clean `main` checkout); zero attributable to touched files.
- [x] `npm run build` — succeeds.
- [x] `npm test` — 2997/3012 pass (net +5 new tests); the 14 failures are
      pre-existing on `main`, unrelated to D2C/Mailchimp. Full
      `lib/d2c/mailchimp/**/__tests__/*.test.ts` suite in isolation:
      32/32 pass (including the pre-existing `provider-segment-opts` and
      `send-live-bypass` suites — confirms the campaign-create path is
      unaffected).
- [x] `npx eslint` on every touched file — zero errors/warnings.
- [ ] Live tag-panel verification (per the ask): "Send test to me" on
      Throwback Algarve autoresp email → refresh Mailchimp Tags panel (no
      new `d2c-test-*`) → refresh Segments panel (temp segment appears then
      disappears within ~10s) → test email arrives — to be run by the user
      after deploy; outside what's drivable from here (no Mailchimp UI
      access, no Throwback API key in local env).

## Notes

Self-merging on green tests per the ask; flagging the spec correction above
prominently since the literal prescription in the ask would not have fixed
anything (it described the mechanism this repo already uses).
