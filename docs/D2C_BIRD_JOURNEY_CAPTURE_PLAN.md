# Bird Journey — DevTools capture plan (SAVE DRAFT ONLY)

**Purpose:** capture the exact HTTP calls Bird Studio makes when you click
**Save** on a journey draft, so `writeJourneyVersion` / `publishVersion` can be
implemented against observed reality instead of inference.

**Scope — read this first.** Capture the **save-draft** action ONLY.
Do **not** click Publish/Activate during the capture, and do not capture it
later. Publishing a journey makes it live against a client WABA and stays a
permanent human action; we are not automating it, now or later. If a request
in your capture has `publish`, `activate`, or a status transition to `live` in
it, discard that request rather than sending it over.

**Why this document exists rather than code:** `JOURNEY_CREATE_VERIFIED` is
`false` and stays false. A journey shell created on its own is useless
(`status: "requires-configuration"`, `trigger: null`, `versionCount: 0`), so we
deliberately do not create one either — an abandoned half-journey in a live
workspace is worse than no journey.

---

## What is already known (do not re-capture)

Verified read-only against the live workspace on 2026-07-29.

**Step 1 — journey envelope.** `POST /workspaces/{wid}/journeys` creates a
shell. Response: `status: "requires-configuration"`, `trigger: null`,
`versionCount: 0`. This call is already implemented and understood.

**Steps 2 and 3 are the unknowns** — how the trigger and the step definition
get written onto a version, and how that version is saved as a draft.

**The trigger shape is confirmed.** All 98 configured journeys in the
workspace (99 total, one unconfigured) use one identical shape:

```jsonc
{
  "type": "journey-contact",
  "data": {
    "contextConditions": {},
    "event": "contact-added-to-group",
    "groupId": "<uuid>"
  },
  "metadata": {
    "sourceId": "<same uuid as groupId>",
    "hookId": "<uuid>",                 // ← server-generated, see below
    "sources": [{ "sourceId": "<uuid>", "hookId": "<uuid>" }],
    "testingSourceId": "00000000-0000-0000-0000-000000000000",
    "additionResources": null
  }
}
```

**Resolved: "Contact Added To List" IS `contact-added-to-group`.** The brief
asked whether the UI's list trigger maps to the API's group trigger or whether
a separate list-based trigger exists. It is the same trigger, because in Bird
**list and group are two names for one resource**:

- `GET /workspaces/{wid}/lists/{id}` and `GET /workspaces/{wid}/groups/{id}`
  return the **same object** for the same id (verified with
  `e3c51596-…` → `T26-LISBOA-MONSTANTOS`).
- `GET /lists` and `GET /groups` return the **same collection**.

So there is no list-vs-group decision to make: pass the list id you see in the
UI as `groupId`. Confirmed, not assumed — but note this was inferred from
equality of responses, so if a future Bird release diverges these endpoints,
re-check before trusting it.

---

## What to capture

In Chrome DevTools → Network, before you start:

1. Tick **Preserve log** (the SPA navigates mid-save and you will lose requests
   without it).
2. Filter to **Fetch/XHR**.
3. Clear the log immediately before the click, so the capture is small.

Then: open a journey, configure a trigger and one message step, click **Save**
(draft) **once**, and stop. Right-click each `api.bird.com` request →
**Copy → Copy as cURL**, and paste them in order.

### The requests to look for

Expect somewhere between two and four calls. In likely order:

| # | Expect | What we need from it |
|---|--------|----------------------|
| 1 | `POST`/`PUT` to `…/journeys/{jid}/versions` | Does creating a version take a body, or is it empty? Does the response carry a `versionId` **and** an edit/lock token? |
| 2 | `PUT`/`PATCH` to `…/journeys/{jid}/versions/{vid}` | **The important one.** Full request body: does it carry `trigger` and `definition` together, or separately? |
| 3 | `PATCH` to `…/journeys/{jid}` | Any envelope-level status change on save (e.g. `requires-configuration` → `draft`). |
| 4 | anything to `…/hooks` or `…/subscriptions` | See the `hookId` question below. |

### For every captured request, we need

- **Method and full URL** (including any query string).
- **Complete request body**, unredacted apart from the `Authorization` header.
- **Complete response body**, including status code.
- **Response headers** if any look stateful (`ETag`, `X-Version`, `Location`).

### Specific questions the capture must answer

1. **Is an `editToken` (or `lock`, `etag`, `revision`) echoed?**
   Check whether a token appears in one response and is sent back in the next
   request. If Bird uses optimistic concurrency, a write that omits it will
   fail or, worse, silently clobber. This is the single most important thing to
   look for.

2. **Where does `hookId` come from?**
   Every live trigger carries `metadata.hookId`, distinct from the `groupId`.
   It is almost certainly server-generated when the trigger is bound. Determine
   whether the client **sends** a `hookId` or **receives** one. If it is
   server-generated we must never invent it — an invented hook id would produce
   a journey that looks configured but is wired to nothing.

3. **Is `trigger` written on the version or on the journey?**
   A read-only finding suggests the version, contradicting the envelope shape.
   The capture settles it.

4. **Does save-draft require a complete `definition`?**
   Note whether Bird rejects a partial step graph, so the implementation knows
   whether it can save incrementally.

5. **What exactly distinguishes draft from published?**
   Needed so the implementation can assert it is on the draft path — not to
   implement publishing.

---

## After the capture

1. Paste the cURLs into `.scratch/bird-journey-save-draft-capture.txt`.
2. Implement `writeJourneyVersion` against the observed bodies, then flip
   `JOURNEY_CREATE_VERIFIED` to `true` **in the same change**.
3. Keep `publishVersion` unimplemented and gated.

**A caution learned the hard way this week.** The existing campaign capture was
headed *"NOT CAPTURED but well-inferred"* for its POST bodies, yet the client
was marked `DRAFT_CAMPAIGN_VERIFIED = true`. Both inferred bodies turned out to
be wrong against the live API — the campaign create needs `type: "broadcast"`,
and the broadcast PATCH must **not** include `type`. Inference from a GET
response is not verification. Only mark a shape verified once a live call has
exercised it, and say plainly in the doc which parts were observed and which
were guessed.
