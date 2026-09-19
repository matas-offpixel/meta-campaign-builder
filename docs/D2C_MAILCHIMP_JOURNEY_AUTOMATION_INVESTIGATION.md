# D2C Mailchimp Journey — programmatic-creation investigation

_2026-07-09. Research-only (no implementation code). Follow-up to PR #704, which
removed the per-fire email autoresp and deferred email delivery to a manually
created Mailchimp Customer Journey. Matas confirmed the brief→live workflow needs
Journey creation to be part of autoresp setup — a manual UI step defeats the D2C
automation goal. This doc investigates whether Journey creation can be automated._

---

## TL;DR / recommendation

| Path | Viable? | Verdict |
|---|---|---|
| **A — Undocumented 3.0 journeys API** (`POST /3.0/customer-journeys/journeys`) | **Maybe — strongest lead** | The public API host advertises `Allow: GET, POST` on the journeys collection and `PATCH/DELETE` on a journey (both undocumented). If the app builder posts here, we can create journeys with the **API key we already have** (no browser). Blocked on one capture to learn the body + whether step-creation is possible. **Pursue first.** |
| **B — Replay captured private-UI endpoints** | Conditional | Collapses into Path A if the UI uses the 3.0 host; becomes fragile/session-bound if it uses an internal host. Resolved by the same capture. |
| **C — Mandrill (Mailchimp Transactional)** | **Yes, fully supported** | Clean, documented `POST /messages/send-template`, cheap at our volume (~$20–40/mo). Abandons the Journey model; separate product, DKIM setup, separate reporting. **Best supported fallback.** |
| **D — Chrome MCP browser orchestration** | Technically yes, operationally poor | Session-dependent (Matas's 2FA), slow, brittle against a canvas/React builder UI. **Not recommended for production automation.** |

**Recommendation:** run the one-shot **capture (Goal 2 runbook)** to resolve Path A.
If `POST /3.0/customer-journeys/journeys` (+ step creation) turns out to be a
key-auth, reusable route, Path A is the clear winner (uses infra we already have,
matches Matas's Journey model). If step-creation isn't reachable via the API,
fall back to **Path C (Mandrill)** as the robust, supported automation path.
**Path D is a last resort only.**

---

## Goal 1 — Marketing API dead-end, re-scanned deeply

### Documented surface (OpenAPI spec + official docs + official Python SDK)

Confirmed across three sources (the full Marketing API OpenAPI YAML, the live
developer reference, and `mailchimp/mailchimp-marketing-python`):

- **Classic Automations** (`/automations`): full CRUD *exists in the spec*
  (`POST /automations` create, `.../actions/start-all-emails`,
  `.../actions/pause-all-emails`, `.../actions/archive`, email sub-resources,
  queues, removed-subscribers). **But Classic Automations were retired June 1,
  2025** — archived, no new contacts enter them. `GET /automations` on the live
  account returns `total_items: 0`. Dead.
  - No **clone / duplicate / create-from-template** endpoint for automations.
    The only `replicate` action in the entire API is
    `POST /campaigns/{id}/actions/replicate` (campaigns only). The Classic
    "workflow templates clone" the brief asked about **does not exist** for
    automations, and has no Customer-Journey successor.
- **Customer Journeys** (now renamed **"Automation flows (Previously Customer
  Journeys)"** in the docs): the spec + docs + SDK expose **exactly one**
  endpoint —
  `POST /customer-journeys/journeys/{journey_id}/steps/{step_id}/actions/trigger`
  — and it only fires a step that was purpose-built in the app with the
  "Customer Journeys API" condition (NOT the `trigger-tag_added` steps our real
  journeys use). No create, no clone, no list in the documented surface.

So on the **documented** surface, the conclusion of PR #704 holds: **no
supported way to create a Journey via API.**

### Undocumented surface (NEW — live `Allow`-header probe, 2026-07-09)

Probing the live 3.0 host (`us7`, API-key auth) with read-only `GET`/`OPTIONS`
turned up an **undocumented write surface** the OpenAPI spec omits. The `Allow`
response header on each resource:

```
GET    /3.0/customer-journeys                     -> 200   Allow: GET
/3.0/customer-journeys/journeys                   ->       Allow: GET, POST          ← undocumented CREATE
/3.0/customer-journeys/journeys/{id}              ->       Allow: GET, PATCH, DELETE ← undocumented update/delete
/3.0/customer-journeys/journeys/{id}/steps        ->       Allow: GET                ← no POST (can't add steps here)
/3.0/customer-journeys/journeys/{id}/steps/{s}    ->       Allow: GET, DELETE
/3.0/customer-journeys/journeys/{id}/steps/{s}/actions/trigger -> Allow: POST        (documented)
```

Interpretation:
- The server **routes `POST` on the journeys collection** and `PATCH`/`DELETE`
  on a journey. These are real routes, not 404s — the same host our production
  code already talks to with the API key. This is the single most important
  finding and it **reopens** the "can we create a Journey via API" question that
  PR #704 closed on the documented surface.
- **Caveat 1 — body schema unknown.** `Allow` proves the method is accepted; it
  says nothing about the required request body. There is no doc, no SDK method,
  and no public forum/GitHub reference to this POST (searched). It is almost
  certainly the endpoint the app's builder uses internally, exposed on the same
  3.0 host.
- **Caveat 2 — step creation gap.** `/journeys/{id}/steps` is **GET-only** (no
  POST). A usable journey needs a `trigger-tag_added` step **and** an
  `action-send_email` step (the latter backed by a campaign/template — see the
  8167 dump). If steps can only be created as part of the journey-create body
  (not added afterward), we need the exact body; if steps can't be created via
  this API at all, Path A can create an empty journey but not a functional one.
- **Caveat 3 — unsupported/ToS.** Undocumented endpoints can change or vanish
  without notice, and building production automation on them may be outside
  Mailchimp's API terms. Treat as "works until it doesn't."

**We deliberately did NOT attempt a live `POST` create** — that would mint a real
journey on a live client account while guessing the body. The safe way to learn
the body is the Goal 2 capture (pure observation). Note the `DELETE` on a journey
is allowed, so a future **controlled create→inspect→delete** experiment on a test
list is feasible *with explicit approval*.

---

## Goal 2 — Reverse-engineer the private UI API

**Status: blocked on authentication; runbook produced.**

- Navigating to `https://admin.mailchimp.com/` redirects to
  `https://login.mailchimp.com/` — **session-cookie auth**, Google/Intuit SSO,
  and (for a business account) near-certainly 2FA. `us7.admin.mailchimp.com/journeys/`
  returns Mailchimp's 404 page (the real builder path differs / is app-routed).
- No authenticated session is available to the agent, so the create-flow capture
  cannot be run headlessly. It must be done by Matas (or with his session paired
  into the Cursor browser).

**Auth mechanism (confirmed):**
- **App/UI:** session cookie on `{dc}.admin.mailchimp.com`, login via
  `login.mailchimp.com` (Intuit-owned). Any internal endpoints the builder calls
  are gated by that cookie (+ likely a CSRF token header).
- **Marketing API (`/3.0/`):** independent **API-key Basic auth** — this is what
  our server already uses, and what makes Path A attractive *if* the builder
  posts to the 3.0 host rather than an internal one.

**The decisive question the capture answers:** does the builder `POST` to
`/3.0/customer-journeys/journeys` (key-reusable → Path A) or to an internal host
like `.../rpc`, `/api/`, or a GraphQL endpoint (session-only → Path B/D)?

Full step-by-step capture procedure + a paste-in template live at
`.scratch/mailchimp-journey-create-capture.txt` (gitignored, alongside the prior
Bird reverse-engineering captures). It mirrors the Bird capture workflow the team
already used for `bird-runtime-send-capture.txt`.

---

## Goal 3 — Mandrill (Mailchimp Transactional) as an alternative

**Fully supported, documented, cheap — but a different product with real switching cost.**

### API surface
- `POST https://mandrillapp.com/api/1.0/messages/send-template.json` (also
  `/messages/send.json`). Auth = API key **in the JSON body** (not Basic).
  `POST`-only REST, or SMTP relay.
- Supports stored templates by `template_name`, dynamic `merge_vars`
  (`merge_language: "mailchimp"` → the same `*|VAR|*` syntax our templates use,
  or Handlebars), `send_at` scheduling (up to 1 year), `track_opens`/`track_clicks`.
- Comprehensive webhook system for real-time open/click/bounce events.

### Pricing (Throwback's volume)
- Add-on to a **Standard plan ($20/mo) or higher** (Essentials not eligible).
- Bought in **blocks of 25,000 emails; $20/block** in the 1–20 block tier
  (decreasing with volume). Blocks expire monthly (no rollover). 500 free test
  emails to start.
- Throwback scale: ~15 active city journeys, ~1–3k signups each → order of
  ~20–50k autoresp emails/month → **1–2 blocks ≈ $20–40/mo** on top of the
  existing plan. Comfortably in the cheapest tier.

### Deliverability + reporting parity
- **Deliverability:** separate sending infra (`mandrillapp.com` return-path).
  Requires its own DKIM setup — 2 CNAMEs (`mte1._domainkey`, `mte2._domainkey`)
  — and optionally a dedicated IP ($29.95/mo, auto-warmup). Once configured,
  deliverability is strong, but it's a **separate domain-auth setup** from the
  Marketing sends.
- **Reporting:** Mandrill has its **own** dashboard + API/webhooks. Transactional
  sends do **not** flow into the Marketing audience's campaign reports or the
  journey reporting Matas reads today — so email stats would live in a different
  place from the rest of the D2C dashboard unless we ingest Mandrill webhooks
  ourselves.

### Migration cost estimate (M–L)
1. Enable Transactional add-on on the account; provision DKIM CNAMEs per sending
   domain (DNS change, one-time per client).
2. Publish each template from the Marketing builder to Transactional (or reuse
   our `renderD2CEmailHtml` output as inline HTML — we already generate the HTML).
3. Swap the email autoresp send path to a Mandrill client (this is essentially
   the *old* per-fire path, but via the transactional API — **no campaigns-list
   pollution**, because transactional sends aren't campaigns).
4. Wire Mandrill webhooks → our dashboard for open/click parity (optional but
   needed for reporting parity).
5. Reconcile with the double-send rule: Mandrill is only safe if Matas does **not**
   also run a Customer Journey for the same event (otherwise we're back to two
   senders). Mandrill fits a world where **we** own the email autoresp again.

**Net:** Mandrill is the cleanest *supported* automation path, but it's an
architectural fork away from Matas's Journey-centric workflow and adds a DNS +
reporting-ingest tail.

---

## Goal 4 — Chrome MCP browser orchestration

**Technically possible, operationally the weakest option.**

- **Session dependency:** requires Matas's authenticated Chrome session to be
  live and available to the automation. Server-side/cron automation cannot hold
  a 2FA-gated Intuit session; it would need a persistent, manually-refreshed
  logged-in browser — a standing operational liability.
- **Latency:** a full "clone journey → replace trigger tag → set content →
  publish" is many navigate/click/wait steps against a heavy React + canvas
  builder. Realistically ~30–120s per journey with retries, versus a sub-second
  API call. Not viable inside a webhook; would need a background queue.
- **Failure modes:** session expiry / forced re-auth mid-run; builder DOM or
  flow changes silently breaking selectors; drag-and-drop canvas steps that
  don't map to stable accessibility refs; iframe'd content the MCP can't reach;
  bot-detection/CAPTCHA. Each is a hard-to-monitor silent failure on a
  revenue-path send.
- **Verdict:** acceptable only as a **one-off human-assisted** helper (e.g.
  speeding up Matas's manual clone), never as the unattended brief→live path.

---

## Risk / reward matrix

| Path | Reward | Risk | Runtime auth | Fits Journey model? | Effort to prove |
|---|---|---|---|---|---|
| **A** Undocumented 3.0 API | **High** — full automation with existing key | **Med-High** — undocumented, may not create steps, could break/ToS | API key (maybe) | ✅ yes | **Low** — 1 capture + 1 controlled create/delete |
| **B** Captured private-UI replay | Med | High if internal host (session/CSRF, brittle) | session cookie | ✅ yes | Low — same capture |
| **C** Mandrill | Med-High — supported, cheap, robust | Low-Med — separate product, DKIM, separate reporting, re-owns sending | key in body | ❌ no (replaces it) | Med — account + DNS + path swap |
| **D** Chrome MCP | Low — automates the UI | **High** — session/2FA, slow, brittle | Matas's session | ✅ yes | Med — fragile build |

---

## If Path A is viable — shape of the PR (outline only, no code here)

Contingent on the capture confirming a **key-auth, reusable** create (+ step)
route on the 3.0 host.

1. **Typed client fns** in `lib/d2c/mailchimp/templates/client.ts` (next to the
   existing `createClassicAutomation`), e.g. `createJourney`,
   `addJourneyTagTrigger`, `addJourneySendEmailStep`, `startJourney`,
   `deleteJourney` — built on the shared `mailchimpJson` helper (Basic auth, one
   retry). Bodies templated verbatim from the capture; byte-diff the create
   payload against the captured expected (per the team's
   `feedback_dry_run_stubs_miss_byte_level_bugs` habit).
2. **Brief-ingest / arm wiring:** on `autoresp_setup` (email) arm, call
   create-journey with `list_id`, the event's signup `tag` (resolve/create the
   `tag_id`), from/reply-to, subject, and content from `renderD2CEmailHtml`
   (or a published template id). Then start it. Store `journey_id` +
   `step_id`s on `result_jsonb.mailchimp_journey`.
3. **Idempotency + guardrail:** before creating, `GET /journeys` and match by
   name (`T26-{CITY}-AUTO`) so re-arming doesn't duplicate; keep the PR #704
   double-send checklist as a belt-and-braces confirmation. Disarm →
   `DELETE`/pause the journey (now possible via `PATCH`/`DELETE`).
4. **Feature-flag + fallback:** gate behind an env flag; if the undocumented
   endpoint 4xx/5xx's, fall back to the PR #704 manual-checklist behaviour so a
   Mailchimp-side change can't break arm.
5. **No schema change** beyond the additive `result_jsonb.mailchimp_journey`
   bag; existing `d2c_autoresp_fires` audit history stays.

**Do not build any of this until the capture confirms the create body and that
step-creation is reachable.** If it isn't, pivot the PR to **Path C (Mandrill)**.

---

## Appendix — evidence log (2026-07-09)

- OpenAPI spec paths: only `/automations*` (Classic, retired) and the single
  `/customer-journeys/.../actions/trigger`. Only `replicate` action = campaigns.
- Live `GET /3.0/automations` → `total_items: 0` (Classic dead on the account).
- Live `Allow` headers (us7, read-only): `journeys` → `GET, POST`; `journeys/{id}`
  → `GET, PATCH, DELETE`; `journeys/{id}/steps` → `GET`; `steps/{id}` → `GET, DELETE`.
- 15 live `T26-*` Customer Journeys on the Throwback list, all `status: sending`;
  journey 8167 = `trigger-tag_added(T26-LONDON)` → `action-send_email(campaign 18156659)`.
- Official docs now label the feature **"Automation flows (Previously Customer
  Journeys)"**; official Python SDK wraps only `customerJourneys.trigger`.
- Mandrill: `POST /messages/send-template.json`, key-in-body, blocks of 25k @ $20,
  Standard-plan prerequisite, separate DKIM + reporting.
- `admin.mailchimp.com` → `login.mailchimp.com` (session-cookie / Intuit SSO) —
  UI capture requires Matas's session.
