# D2C Bird — programmatic autoresp automation investigation

_2026-07-09. Research-only (no implementation code). Follow-up to the abandoned
Mailchimp-Journey automation path. Matas decision: pivot D2C brief-to-live
autoresp to WhatsApp/Bird. Target trigger shape: **"contact tagged with
`T26-{EVENT_CODE}` → send approved WhatsApp template with event-specific
variables (`event_name`, `event_date`, `presale_day`, `presale_time`,
`event_artwork_url`, `wa_community_invite`)."**_

---

## TL;DR / recommendation

**This is the opposite of the Mailchimp dead-end. Path A (programmatic creation)
is viable — pursue it.** Bird exposes the automation objects on the same
`api.bird.com` host our server already uses with the workspace `AccessKey`, and
we have a working precedent (the draft-campaign nested-create flow) for replaying
SPA writes with that key.

Two corrections/findings up front:

1. **The primitive is a Bird _Journey_, not a Bird _Flow_.** Bird "Flows" are
   conversation automations (channel / webhook / connector triggers). Bird
   "Journeys" are marketing autoresponders triggered by **contact-added-to-group**.
   Matas's `T26-*` autoresponders are **Journeys** — the workspace has **92** of
   them, all `contact-added-to-group`, named `T26-London`, `T26-MADRID`,
   `T26-Porto-Auto`, etc.
2. **"Contact tagged with `T26-X`" maps natively to "contact added to Bird group
   `T26-X`."** A Bird **group** is the analog of a Mailchimp tag/list. Groups
   already exist per event (`T26-LISBOA-4`, `T26-ARAXA`, `H26-PORTO`, …). Both the
   trigger and the send-template action we need are **confirmed present** in
   production journey definitions.

| Path | Viable? | Verdict |
|---|---|---|
| **A — Programmatic Journey creation** (`api.bird.com` + AccessKey) | **Yes — recommended** | Objects are fully API-readable; create-body shape already derived; SPA-write replay precedent exists (campaigns). One UI capture to nail the create→version→publish call *sequence*, then build. |
| **B — Keep per-fire `/messages`** (PR #700) | Works, but | Re-owns sending (double-send risk if a Journey also exists for the same group — the exact Mailchimp lesson), no native Bird journey reporting/retry, doesn't match Matas's model. Good **fallback** only. |
| **C — Manual clone per event** | The trap | This is what's happening now (92 journeys, many literally named `(copy)`). Defeats brief-to-live automation. Reject. |
| **Pivot away from Bird** | No | Templates are approved on Bird, 92 journeys already live there. No reason. |

**Update (2026-07-09, post-approval controlled probe):** Matas approved a live,
guarded create→capture→delete probe on a throwaway `ZZ-CAPTURE-TEST` group. It
ran cleanly (group created, then deleted, zero residue, no `T26-`/`H26-`
resource ever touched) but **the journey-create call failed on the first
attempt**: `POST /journeys` rejects a top-level `trigger` field
(`422 property "trigger" is unsupported"`), even though `GET` on existing
journeys returns one. Per the agreed no-retry rule, no alternate body was
guessed programmatically. **Path A is therefore still open, not confirmed** —
this is a real, narrowing negative result, not a dead end: the create envelope
is reachable and mutable (proven by the successful group create/delete), we
just don't yet know its accepted shape or where `trigger` actually gets
attached. Full detail in "Controlled probe" below.

**Update 2 (2026-07-10, controlled probe #2, Matas-approved):** a second
guarded probe sent `POST /journeys { name }` — name only, nothing else —
against a fresh `zz-capture-test-<uuid>` journey (no group needed this time).
**It succeeded (201).** The response is a genuinely useful shape delta:

```json
{ "id": "...", "status": "requires-configuration", "trigger": null,
  "draftVersion": null, "versionCount": 0,
  "capabilities": { "audienceEnrollment": false }, ... }
```

So the minimal create body is confirmed to be exactly `{ name }`; a fresh
journey is an inert shell with `trigger: null` and **zero auto-created
versions** (`GET .../versions` → `{"results":[]}`). Cleaned up immediately
(`DELETE` → 204); verified zero residue and journey total unchanged at 92.

This means at least **two more calls** — not yet identified or tested — are
needed to reach the live shape (trigger set, a version with steps,
`capabilities.audienceEnrollment: true`): something that attaches `trigger`
to the journey, and something that creates a version carrying the step
definition, plus a publish action. See "Candidate multi-call sequence" below
— these are **outlined hypotheses, not confirmed calls**.

**Recommendation (unchanged in substance):** the required next step is now the
**DevTools capture** (runbook in `.scratch/bird-flow-create-capture.txt`,
updated with both probes' findings) to observe the real trigger-attach,
version-create, and publish calls. Keep per-fire (Path B) as the flagged
fallback in the meantime.

---

## Goal 1 — Bird automation API surface (documented + probed)

**Auth:** `Authorization: AccessKey <BIRD_API_KEY>` — a long-lived workspace key
(no refresh), via `lib/d2c/bird/client.ts`. Same key, same host (`api.bird.com`)
the SPA (`app.bird.com`) talks to. The draft-campaign capture established that the
AccessKey **routes identically to the SPA's Bearer JWT** (`editorType:"accesskey"`
on our resources) — the reason Path A is credible.

**Read surface (live-probed 2026-07-09, all 200 with our key):**

```
GET /workspaces/{ws}/journeys?limit=100            -> list (total = 92)
GET /workspaces/{ws}/journeys/{id}                 -> journey envelope
GET /workspaces/{ws}/journeys/{id}/versions        -> version list
GET /workspaces/{ws}/journeys/{id}/versions/{vid}  -> FULL step-graph definition
GET /workspaces/{ws}/journeys/{id}/steps           -> 422 (needs params)
GET /workspaces/{ws}/journeys/{id}/runs            -> 504 (heavy)
GET /workspaces/{ws}/flows[/{id}]                  -> 200 (conversation flows; 1 exists)
GET /workspaces/{ws}/groups | /lists | /contacts   -> 200
GET /workspaces/{ws}/{automations|triggers|workflows|flow-runs} -> 404
```

**The Mailchimp OPTIONS/`Allow` method-probe does NOT work on Bird.** `OPTIONS`
on `/journeys` and `/journeys/{id}` returns **HTTP 400** (Bird doesn't emit an
`Allow` header). So we cannot cheaply enumerate write methods that way. Instead
the write-path evidence is:

- Every journey + version definition is **fully readable** with our key (so we
  already know the exact body a create must produce — see Goal 3).
- **Precedent:** Bird's SPA create flow for broadcast **campaigns** is a nested
  `POST envelope → POST child → PATCH config` sequence that we captured and now
  replay in production with the AccessKey (`lib/d2c/bird/campaigns/client.ts`,
  `DRAFT_CAMPAIGN_VERIFIED = true`). Journeys almost certainly follow the same
  create → draft-version → publish lifecycle (the version detail exposes a
  `draftVersion` slot, an `editToken`, and an `accesskeyId` on the version).

**Update — controlled probe executed (2026-07-09, Matas-approved).** A guarded
script (`.scratch/bird-journey-create-probe.mjs`) ran the sequence against a
throwaway `ZZ-CAPTURE-TEST` group, hardcoded/asserted to never touch any
`T26-`/`H26-` resource:

1. `POST /workspaces/{ws}/groups {name:"ZZ-CAPTURE-TEST"}` → **201**, confirmed shape.
2. `POST /workspaces/{ws}/journeys {name, trigger:{...}}` → **422**
   `"property \"trigger\" is unsupported"`. The create envelope does **not**
   accept a top-level `trigger`, despite `GET` returning one on existing
   journeys — trigger attachment happens through some other call we haven't
   identified yet.
3. Per the no-retry guardrail, the script stopped immediately, logged the
   failure (tagged `[D2C_BIRD_PROBE]`, full request/response in
   `.scratch/bird-journey-create-probe-capture.txt`), and ran cleanup: the test
   group was deleted (`204`). No journey was ever created (step 2 failed before
   an id existed). Post-run `GET /groups` and `GET /journeys` confirm **zero
   residue** and an unchanged journey total (92) — no live client resource was
   touched.

This is a genuine, narrowing finding, not a dead end: the journeys collection
*is* POST-reachable with our key (it returned a structured 422, not a 401/403 or
route-not-found), so the resource is mutable — we just have the wrong envelope
shape.

**Update — probe #2 (2026-07-10, Matas-approved), name-only create: SUCCEEDED.**
`POST /workspaces/{ws}/journeys { name: "zz-capture-test-<uuid>" }` → **201**:

```json
{ "id": "8e228cb6-...", "status": "requires-configuration", "name": "zz-capture-test-...",
  "secrets": {}, "settings": { "maxSteps": 200 }, "trigger": null,
  "publishedVersion": null, "publishedVersionStepCount": 0, "draftVersion": null,
  "versionCount": 0, "invocationCount": 0, "conversionCount": 0,
  "capabilities": { "audienceEnrollment": false }, "createdAt": "...", "updatedAt": "..." }
```

Immediate follow-up `GET /journeys/{id}` returned the identical envelope;
`GET /journeys/{id}/versions` returned `{"results":[]}` — **no version is
auto-created**. `DELETE /journeys/{id}` → 204; verified zero residue and
journey total unchanged at 92 immediately after.

**Confirmed:** the minimal create body is exactly `{ name }`. A fresh journey
is an inert, unconfigured shell (`status: "requires-configuration"`,
`trigger: null`, `versionCount: 0`, `capabilities.audienceEnrollment: false` —
the last of which is `true` on every live/configured journey, so this flag
flips once configuration completes). **Not yet confirmed:** the call(s) that
attach `trigger` and create a version with steps, and the publish call — see
"Candidate multi-call sequence" immediately below.

### Candidate multi-call sequence (outline — untested beyond step 1)

1. **CONFIRMED** — `POST /workspaces/{ws}/journeys { name }` → 201, inert shell
   (`trigger: null`, `versionCount: 0`).
2. **CANDIDATE, untested** — attach the trigger. Most likely
   `PATCH /workspaces/{ws}/journeys/{id} { trigger: {...} }`. Neither probe has
   PATCHed a journey envelope successfully or unsuccessfully yet — this is a
   hypothesis based on the envelope being a normal resource with a `trigger`
   field, not evidence.
3. **CANDIDATE, untested** — create a version carrying the step definition.
   Most likely `POST /workspaces/{ws}/journeys/{id}/versions { definition: {...} }`.
   `GET` on that same collection is confirmed 200 (empty list on a fresh
   journey) — necessary but not sufficient evidence that `POST` is supported
   there.
4. **CANDIDATE, untested** — publish. Most likely
   `PUT /workspaces/{ws}/journeys/{id}/versions/{vid}/publish`, by analogy
   with the **confirmed** `PUT .../channel-templates/{id}/activate` verb-suffix
   pattern already verified for templates (`lib/d2c/bird/templates/client.ts`).

**Confirming the exact trigger-attach, version-create, and publish calls now
requires the Goal 4 DevTools capture** (updated with both probes' results) or a
further Matas-approved controlled probe against steps 2–4 — not more blind
guessing beyond what's outlined here.

**Provisional PR outline drafted (2026-07-10):** while the DevTools capture is
in flight (Matas-approved, via Chrome MCP orchestration), a full provisional
outline against this candidate sequence — client wrapper, group resolver,
definition builder, arm/disarm wiring, feature flag, and the PR #704-style
subtractive dedup for the existing per-fire poll cron — is written up in
`docs/D2C_BIRD_JOURNEY_PR_OUTLINE_PROVISIONAL.md`. Every TBD body there is
tagged for swap-out once the capture lands; nothing in it is implemented yet.

**Read-only corroboration, not a probe #3 (2026-07-10 09:2x UTC).** A journey
`zz-capture-test-2026-07-09` (id `61e955e9-a495-4a82-a103-d78049ae8217`) was
found live on the workspace — **not created by this agent**; it's Matas's own
in-progress DevTools-capture object, using our `zz-capture-test-` naming
convention. Two zero-risk `GET`s on it (never a probe this agent initiated —
just inspecting an object flagged by the user) surfaced one real, useful
correction to the candidate sequence:

- **`trigger` lives on the *version* object, not the journey envelope.** The
  journey envelope's `trigger` field was `null` even though a draft version
  existed (`versionCount: 1`) — matching the earlier read of a *published*
  version (`C26-Barcelona`), whose version object carried its own
  `trigger`/`isTriggerValid` fields alongside `definition`. The journey
  envelope's `trigger` is most likely just a denormalized copy of the
  *published* version's trigger, not an independently-settable field. This
  means candidate steps 2 (attach trigger) and 3 (create version) may
  **collapse into one call** — writing `{ trigger, definition }` together onto
  a version — rather than being two separate PATCH/POST calls as originally
  outlined. Still a candidate, not confirmed: the exact verb (`PATCH`/`PUT`)
  and whether the version's `editToken` must be echoed back (optimistic
  concurrency — versions carry one) remain open until the network capture
  lands.
- **Version auto-creation is real, just not "bare".** `versionCount` went
  `0` (probe #2, bare `{name}` create) → `1` on this object, which had been
  opened in the builder — so *something* creates a version early, before any
  trigger/step is configured (`stepCount: 0`, `isValid: false` on the version
  read). Confirms candidate step 3 is a real, separate action from the shell
  create, just possibly auto-fired on first entering the builder rather than
  an explicit user action.

**Cleanup:** deleted per Matas's own request (guarded by the same
`assertSafeName`-style check as probe #1/#2 — name matched `zz-capture-test-*`,
never `T26-`/`H26-`). `DELETE` → 204. The immediate post-delete list read
showed `total: 93` (propagation lag on Bird's list endpoint); a re-check
seconds later confirmed `GET` on the id → **404** and `total: 92` with zero
`zz-capture-test` residue — genuinely restored to baseline, not just assumed.
Appended to `.scratch/bird-journey-create-probe-capture.txt`.

**No documented public "create Journey" endpoint / no "duplicate Journey" /
"workflow template clone" in Bird's published API docs.** Like campaigns, journey
authoring is an SPA-driven (undocumented-but-key-reachable) surface, not a
published REST operation.

---

## Goal 2 — Trigger + action availability

### Trigger: tag-added → **available natively as `contact-added-to-group`** ✅

All 92 Throwback journeys use:

```json
"trigger": { "type": "journey-contact",
             "data": { "event": "contact-added-to-group",
                       "groupId": "<per-event group uuid>" } }
```

A Bird **group** is the tag/list analog. "Tagged with `T26-{EVENT_CODE}`" ≙ "added
to group `T26-{EVENT_CODE}`". Groups already exist per event with exactly this
naming (`T26-LISBOA-4`, `T26-ARAXA`, `H26-PORTO`, …), shape `{ id, name,
contactCount, createdAt }`. `capabilities.audienceEnrollment: true` on journeys
suggests bulk enrollment is supported as well as per-add.

> For completeness (Flows, which we are **not** using): Bird Flows have 8 trigger
> types — Agent, Connector, Contact (created/updated/deleted), Conversation, Feed
> item, Message lifecycle, Webhook, Voice. A literal **"contact tag added"** event
> is only offered via a **Connector** integration (e.g. ActiveCampaign) or a
> **Webhook** trigger — it is _not_ a native Bird-contact Flow event. This is
> moot because the Journey `contact-added-to-group` trigger covers our need.

### Action: send WhatsApp template with variables → **confirmed** ✅

The published version definition of a live journey (`C26-Barcelona`) contains:

```json
"steps": {
  "createChannelMessage_ejRu": {
    "type": "mrn:v1:channels:endpoints:createChannelMessage:1.0.0",
    "parameters": {
      "payload": {
        "receiver": { "contacts": [{ "id": "{{contact.id}}" }] },
        "template": { "projectId": "d53fa0e9-…", "version": "de09ce6b-…",
                      "locale": "en", "name": "", "variables": { } },
        "capFrequency": true, "utm": { "enabled": true }, … },
      "request": { "channelId": "bb6e267e-…", "workspaceId": "{{run.workspaceId}}" }
    },
    "next": "terminate_d9tv"
  },
  "terminate_d9tv": { "type": "terminate", "parameters": { "fail": false } }
}
```

This is **exactly our Project+Version template pattern** (`projectId` +
`version` + `variables` + `channelId` + `locale`) — the same identity model
`lib/d2c/bird/provider.ts` and `campaigns/client.ts` already use. Our approved
templates (`throwback_autoresp`, `throwback_presale_reminder`,
`throwback_presale_live`) plug straight into the `template` block; the six target
variables map into `template.variables`. The enrolled contact is referenced as
`{{contact.id}}`.

---

## Goal 3 — Reference definitions (the create-body schema)

Enumerated all 92 journeys and dumped a full example to `.scratch/`:

- `.scratch/bird-journey-fetch.json` — journey envelope (`C26-Barcelona`).
- `.scratch/bird-journey-versions.json` — version list.
- `.scratch/bird-journey-version-detail.json` — full step graph (send + terminate).

**Create-body template** (what a programmatic create must reproduce):

```
Journey envelope:
  { name: "T26-{EVENT_CODE}", status: "active", settings: { maxSteps: 200 },
    trigger: { type: "journey-contact",
               data: { contextConditions: {}, event: "contact-added-to-group",
                       groupId: "<event group uuid>" } } }

Version.definition:
  startAt: "createChannelMessage_X"
  steps:
    createChannelMessage_X : { type: "mrn:v1:channels:endpoints:createChannelMessage:1.0.0",
      parameters: { payload: { receiver: { contacts: [{ id: "{{contact.id}}" }] },
                               template: { projectId, version, locale, name:"", variables:{…6 vars…} },
                               capFrequency:true, ignoreGlobalHoldout:false, utm:{enabled:true} },
                    request: { channelId, workspaceId: "{{run.workspaceId}}" } },
      next: "terminate_Y" }
    terminate_Y : { type: "terminate", parameters: { fail:false } }
```

Naming pattern is confirmed by the live data: `T26-{CITY}` / `{CODE}26-{CITY}`,
often suffixed `-Auto`/`-AUTORESPONDER`. **Many are literally named `(copy)`** —
direct evidence Matas clones them by hand today (the trap to eliminate).

---

## Goal 4 — Private UI API (fallback / capture)

- `app.bird.com` is an SPA authenticated by a **Bearer JWT session** (Intuit-style
  SSO not involved; Bird's own login). But — key point — the SPA calls the **same
  `api.bird.com` endpoints** our AccessKey already reaches (proven for campaigns).
  So a captured journey-create sequence is expected to be **replayable with our
  server AccessKey**, no browser at runtime.
- Because `OPTIONS` returns 400 (no `Allow`), the exact create call **sequence**
  (envelope → draft version write → publish) can only be confirmed by watching the
  SPA. A full DevTools capture runbook + the already-derived body shape is in
  **`.scratch/bird-flow-create-capture.txt`** (mirrors the successful
  `bird-campaign-draft-capture.txt` workflow). Matas runs it in his session, or
  approves a controlled server-side create→publish→DELETE on a test group.

---

## Goal 5 — Realistic constraint check

- **Per-fire (PR #700) works** and stays as the safety net. But it makes *our
  system* the sender, which re-creates the **double-send hazard** the Mailchimp
  investigation surfaced: if a Journey exists for the same group AND we also fire
  per-contact, the fan gets two messages. The clean model (matching the Mailchimp
  pivot) is: **the Journey owns the send; we stop firing.**
- **Manual clone per event is the current reality and the trap** — 92 journeys,
  many `(copy)`. It does not scale to brief-to-live and is exactly what this work
  should remove.
- **Bird is materially more automatable than Mailchimp was.** Mailchimp's journey
  objects were opaque (create totally undocumented, only an `Allow: POST` hint,
  session-only UI). Bird's journey objects are **fully API-readable with our
  existing key**, and we have a **proven SPA-write-replay precedent**. Path A is a
  real, low-to-medium-risk build here, not a research dead-end.

---

## Risk / reward matrix

| Path | Reward | Risk | Runtime auth | Fits Matas's model? | Effort to prove |
|---|---|---|---|---|---|
| **A** Programmatic Journey create | **High** — true brief-to-live, native Bird retry/dedup/reporting, uses existing key | **Med** — create envelope confirmed (`{name}` → inert shell); trigger-attach + version-create + publish calls are still unconfirmed candidates | AccessKey (confirmed — 2 creates + 2 deletes all succeeded live) | ✅ yes | **Low** — 3 candidate calls left; 1 DevTools capture (or further approved probes) resolves them |
| **B** Keep per-fire `/messages` | Med — already works | Med — double-send risk vs any Journey, no journey-level reporting, we own sending | AccessKey | ⚠️ partial | none (shipped) |
| **C** Manual clone | Low | High — doesn't scale, human step every event | UI session | ❌ (the trap) | n/a |

---

## If Path A viable — shape of the PR (outline only, no code)

Contingent on the capture confirming the create→version→publish call sequence.

1. **Bird journeys client** `lib/d2c/bird/journeys/client.ts`, mirroring
   `campaigns/client.ts` on `birdFetch`/`birdJson` (AccessKey): `listJourneys`,
   `findJourneyByName`, `createJourney` (envelope), `writeDraftVersion`
   (definition/step graph), `publishJourney`, `deactivateJourney`/`deleteJourney`.
   Byte-diff every create body against the capture (per
   `feedback_dry_run_stubs_miss_byte_level_bugs`).
2. **Group resolver** `resolveOrCreateGroup(name = "T26-{EVENT_CODE}")` → groupId
   (GET `/groups`, match by name, else `POST /groups`). Idempotent by name.
3. **Journey definition builder** — pure fn producing the envelope
   (`trigger.contact-added-to-group` + groupId) and version `definition.steps`
   (`createChannelMessage` → the event's approved template `projectId`+`version`,
   `variables` = the 6 target vars, `channelId`; `terminate`). Reuses the
   Project+Version + variable hydration already in `lib/d2c/bird/*`.
4. **Wire into `autoresp_setup` arm / brief-ingest:** on arm → resolve group →
   create journey → publish. Store `journey_id` / `group_id` / `version_id` on
   `d2c_scheduled_sends.result_jsonb.bird_journey`. Idempotent by journey name so
   re-arming never produces a `(copy)`.
5. **Runtime enrollment:** on signup, add the Bird contact to the event's group
   (`POST` group membership) — this natively triggers the Journey. This
   **replaces** the per-fire `/messages` send (kills the double-send hazard).
   Confirm enrollment semantics in the capture (new-add fires; `audienceEnrollment`
   likely allows retroactive bulk enroll for backfill).
6. **Disarm:** deactivate (status `inactive`) or delete the journey; membership
   stops enrolling.
7. **Guardrails:** gate live create behind the existing 3-of-3 D2C dry-run gate +
   Matas approval; feature-flag the whole path with automatic fallback to per-fire
   (Path B) on any create/publish failure. No schema change beyond the additive
   `result_jsonb.bird_journey` bag.

**Do not build until the capture confirms the create/publish sequence.** The
AccessKey is now confirmed to perform writes (group create + delete both
succeeded live); what's still missing is the correct journey-create body and
the call that attaches `trigger`. Everything else (trigger semantics, send
action, template model, group model, naming) is already confirmed against live
data.

**Status as of 2026-07-09: still contingent, not confirmed.** The controlled
probe narrowed the unknown (envelope create fails on `trigger`, cleanly rolled
back, zero live-resource impact) but did not complete the sequence. This
outline is not yet gated for implementation — it awaits the DevTools capture
(or a further Matas-approved probe against the corrected body once observed).

---

## Appendix — evidence log (2026-07-09, Throwback ws `9c308f77…`)

- `/journeys` total **92**, every one `journey-contact / contact-added-to-group`,
  ~all 2-step (send template + terminate). Names: `T26-London`, `T26-MADRID`,
  `T26-MUNICH`, `T26-BERLIN`, `T26-Porto-Auto`, `T26-Porto-Auto (copy)`, … (many `(copy)`).
- Journey envelope + version definition read in full with the AccessKey (dumped to
  `.scratch/bird-journey-*.json`). Send step type
  `mrn:v1:channels:endpoints:createChannelMessage:1.0.0`, template by
  `projectId`+`version`+`variables`, `receiver.contacts=[{id:"{{contact.id}}"}]`.
- `/flows` = 1 (`WhatsApp subscription flow (imported)`, trigger
  `channel/incoming_message_delivered`) — conversation product, not our use case.
- `/groups` read 200; groups named per event (`T26-LISBOA-4`, `T26-ARAXA`,
  `H26-PORTO`), shape `{id,name,contactCount,createdAt}`. `/lists`, `/contacts` 200.
- `OPTIONS /journeys` → **400** (no `Allow`) — Mailchimp method-probe technique N/A.
- Auth = `AccessKey`; same host + endpoints as the SPA (campaigns replay precedent,
  `lib/d2c/bird/campaigns/client.ts`).
- **Controlled probe (post-approval, 2026-07-09 23:12 UTC):**
  `POST /workspaces/{ws}/groups {name:"ZZ-CAPTURE-TEST"}` → 201; immediately
  followed by `POST /workspaces/{ws}/journeys {name, trigger}` → **422
  `property "trigger" is unsupported"`**. Script stopped (no retry), deleted the
  test group (`204`), verified zero residue and unchanged journey total (92).
  Approved template used for the (unreached) send step:
  `throwback_autoresp` project `e562d41e-444f-431e-867b-55f1c27a9a91`, active
  channel-template `20f8c457-1d96-4d45-99de-1ab7948b1599`, WhatsApp channel
  `04dcc60a-39df-51db-bcb0-6aab68de54b1` ("THROWBACK", from the project's
  `approvedTemplateChannelsId`). Full log:
  `.scratch/bird-journey-create-probe-capture.txt`; script:
  `.scratch/bird-journey-create-probe.mjs`.
- **Controlled probe #2 (post-approval, 2026-07-10 07:22 UTC):**
  `POST /workspaces/{ws}/journeys {name:"zz-capture-test-<uuid>"}` → **201**,
  inert shell (`status:"requires-configuration"`, `trigger:null`,
  `draftVersion:null`, `versionCount:0`,
  `capabilities.audienceEnrollment:false`). `GET .../versions` →
  `{"results":[]}` (no auto-created version). `DELETE` → 204; verified zero
  residue, journey total unchanged at 92. Confirms the minimal create body is
  `{ name }` only; trigger-attach and version-create/publish calls remain
  unconfirmed candidates (see "Candidate multi-call sequence" above). Script:
  `.scratch/bird-journey-create-probe-2.mjs`; log appended to the same
  `.scratch/bird-journey-create-probe-capture.txt`.
