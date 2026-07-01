# D2C Bird Studio template-creation API — reverse-engineering audit

**Date:** 2026-06-30 → 2026-07-01 (overnight sprint)
**Author:** Cursor (d2c thread)
**Scope:** Reverse-engineer Bird's **internal Studio** `POST /workspaces/{wid}/projects/{pid}/channel-templates` endpoint well enough to programmatically create WhatsApp message templates across brands, then ship 5 templates.

> **Load-bearing caveat:** this endpoint is **not publicly documented**. It is the request the Bird Studio web UI fires. Bird can change it without notice. Everything below is empirical, derived from (a) a DevTools capture of a real 201 create and (b) live read-only GETs against the production workspace. Treat this as a snapshot, not a contract. See §f Risk register.

Workspace: `9c308f77-c5ed-44d3-9714-9da017c7536c`
Auth: `Authorization: AccessKey <BIRD_API_KEY>` (env). **Confirmed working on GET** (listProjects, listTemplates → 200). Create-auth verified in Phase 2 (§Probe log).

---

## a) Parsed DevTools capture (`.scratch/bird-post-capture.txt`)

**Request line**

```
POST https://api.bird.com/workspaces/9c308f77-c5ed-44d3-9714-9da017c7536c/projects/d6dd63a5-5005-41a7-a3ec-43e7850eee41/channel-templates
```

- `{wid}` = workspace, `{pid}` = **project** `d6dd63a5…` (the throwaway "test" project).
- Response: **201 Created**.

**Headers**

| Header | Value | Notes |
|---|---|---|
| `Authorization` | `Bearer <SSO JWT>` | Short-lived (`exp≈1782898633`, ~2026-07-01 — already/nearly expired). `loginMethod: sso`. **Cannot be refreshed programmatically.** |
| `Content-Type` | `application/json` | |

> The capture's Bearer JWT is a blocker *if* it were the only accepted auth. **Phase-1 GETs proved the long-lived `AccessKey` works**, so we build on `AccessKey` and never touch the JWT. (Create-auth confirmed in Phase 2.)

**Body (verbatim shape, test create — no variables, no button):**

```jsonc
{
  "defaultLocale": "en",
  "genericContent": [],                       // always empty for WhatsApp
  "platformContent": [{
    "platform": "whatsapp",
    "locale": "en",
    "type": "image",                          // template media type (header kind)
    "channelGroupIds": ["5023d43f-5d40-494b-b024-1fad53e8338a"],  // Jackies WABA
    "blocks": [
      {"type": "image", "role": "header", "image": {"mediaUrl": "…", "altText": ""}, "id": "<nanoid>"},
      {"type": "text",  "role": "body",   "text":  {"text": "…"}, "id": "<nanoid>"},
      {"type": "text",  "role": "footer", "text":  {"text": "…"}, "id": "<nanoid>"}
      // button omitted in this capture; see GET shape below for link-action
    ]
  }],
  "variables": [],
  "supportedPlatforms": ["whatsapp"],
  "shortLinks": {"enabled": true, "domain": "brd1.eu"},
  "deployments": [
    {"key": "whatsappTemplateName", "platform": "whatsapp", "value": "test"},
    {"key": "whatsappCategory",     "platform": "whatsapp", "value": "MARKETING"}
  ]
}
```

Block `id`s are **client-generated nanoids** (21-char). The server accepts them as-is.

## b) POST vs GET field map

The full GET shape came from `GET …/projects/08bab722…/channel-templates` (the live, Meta-approved `throwback_presale_live` template — has variables **and** a button). Raw dump: `.scratch/bird-discovery.json`.

| Field | In POST? | In GET? | Role | Required to create? |
|---|---|---|---|---|
| `defaultLocale` | ✅ | ✅ | first/primary locale | **required** |
| `genericContent` | ✅ `[]` | ✅ `[]` | non-WhatsApp content | send `[]` |
| `platformContent[]` | ✅ | ✅ | per-locale content | **required** (≥1) |
| `platformContent[].platform` | ✅ | ✅ | `"whatsapp"` | **required** |
| `platformContent[].locale` | ✅ | ✅ | e.g. `en`, `es-ES` | **required** |
| `platformContent[].type` | ✅ (1st) | ✅ (1st only; `null` on extra locales) | header media kind (`image`) | required on first entry |
| `platformContent[].channelGroupIds[]` | ✅ | ✅ | **the WABA** | see §c probe |
| `platformContent[].blocks[]` | ✅ | ✅ | header/body/footer/button | **required** |
| `platformContent[].blocks[].id` | ✅ | ✅ | client nanoid; **shared across locales** | provide (reuse per role across locales) |
| `platformContent[].approvals[]` | ❌ | ✅ | **server-generated** Meta approval records | never send |
| `variables[]` | ✅ | ✅ | declared template variables | send `[]` or full (see §c) |
| `supportedPlatforms` | ✅ | ✅ | `["whatsapp"]` | **required** |
| `shortLinks` | ✅ | ✅ | link-shortening toggle | optional (`{enabled:false,domain:"brd1.eu"}`) |
| `deployments[]` | ✅ | ✅ | name + category | **required** |
| `styles[]` | ❌ (capture) | ✅ | cosmetic defaults | optional — server defaults |
| `platformInfo` | ❌ | ✅ | **server-generated** per-locale status/category/qualityRating | never send |
| `id`,`projectId`,`status`,`createdAt`,`updatedAt`,`isCloneable`,`editorId/Type`,`publisherId/Type`,`assets` | ❌ | ✅ | **server-generated** | never send |

### Variables shape (RESOLVED from GET)

```jsonc
"variables": [{
  "key": "event_name",
  "type": "string",
  "format": "none",
  "description": "Display name of the event",
  "examplesLocale": {
    "en":    { "exampleValueStrings": ["Throwback - PORTO"] },
    "es-ES": { "exampleValueStrings": ["Throwback - PORTO"] }
  }
}]
```

- Variables are **named**. Blocks reference them inline as `{{event_name}}` (header `mediaUrl: "{{event_artwork_url}}"`, body text, button url `https://ra.co/events/{{event_url_suffix}}`).
- **This is NOT the positional `{{1}}` scheme** of the public channels API (which is what `submit-bird-templates.mjs` targeted). Our declarative `{{varName}}` maps 1:1 onto Studio's named vars — no positional conversion.
- `examplesLocale` provides the Meta-review sample values, one array per locale.

### Button (link-action) shape (RESOLVED from GET)

```jsonc
{"id": "<nanoid>", "type": "link-action", "linkAction": {"text": "ACCESS TICKETS", "url": "https://ra.co/events/{{event_url_suffix}}"}}
```

### Multi-locale (RESOLVED from GET)

**One template, N `platformContent` entries** (one per locale). Observed: `en` + `es-ES` in a single template. The first entry carries `type: "image"`; subsequent entries have `type: null`. **Block `id`s are reused across locales** (same `id` for the body block in both `en` and `es-ES`). `deployments[].locale` is `null` (name/category are template-wide, not per-locale).

## c) Remaining unknowns (probe targets)

| # | Unknown | Hypothesis | Probe |
|---|---|---|---|
| U1 | Does `AccessKey` work for **POST** (create)? | Yes (works for GET) | Create 1 minimal template, check status |
| U2 | Is `channelGroupIds` **required**, or can it be omitted to make a non-submitted draft? | Omitting may create a local draft not sent to Meta | Create w/o channelGroupIds; inspect `approvals` / `status` |
| U3 | Exact minimal `variables` entry accepted at create | `key/type/format/description/examplesLocale` | Create with 1 var, GET back, diff |
| U4 | Category location: top-level vs `deployments`? | In `deployments` (capture) | Confirmed by capture; verify GET |
| U5 | Sync vs async; where does Meta approval status live? | Returns 201 immediately; `platformContent[].approvals[]` + `platformInfo` poll | Create, GET immediately + after delay |
| U6 | Can **projects** be created via API? | `POST /workspaces/{wid}/projects` | Attempt minimal create |
| U7 | Delete endpoint shape | `DELETE …/channel-templates/{id}` | Delete a probe template, expect 2xx/204 |

## d) Probe strategy (cleanup-mandatory)

- **Budget:** ≤ 20 creates total. Every create is followed by a `DELETE`.
- **Isolation:** probe in a dedicated `_test_probe_delete_me` project (U6). If project-create is unsupported, fall back to the existing throwaway `test` project (`d6dd63a5…`) — **never** a production-brand project.
- **Meta-pollution minimisation:** prefer creating probe templates **without** `channelGroupIds` first (U2). A template with no WABA cannot be submitted to Meta, so it stays a local draft — zero approval-queue impact. Only include a channelGroup if the API rejects the draft, and then delete immediately.
- **Evidence:** each probe records `{intent, request, status, responseBody}` appended to §Probe log below, plus a `DELETE` confirmation.
- **Hard stop:** if any create returns an ambiguous partial success, or a delete fails (leaving a live template), STOP and surface before continuing.

## e) Bird project / WABA model

- **Project** (`projectId`): a Studio container that holds channel-templates. Matas's workspace has ~100 projects, mostly **one per event** (`T26-PORTO`, `j26-madrid-…`) plus a few **brand master** projects (`throwback_template-presale-live` = `08bab722…`, `throwback_presale_live` = `809d5489…`).
- **Channel group** (`channelGroupId`): the **WABA** (WhatsApp Business Account) a template is submitted under. Distinct from **channel id**. Confirmed IDs:
  - **Throwback WABA** `channelGroupId = 6ae0be5c-2d1e-4b8b-ab6e-4362e60354a6` — **discovered** here (was "UNKNOWN" in the capture notes), extracted from the live `throwback_presale_live` template's `platformContent[].channelGroupIds`.
  - **Jackies WABA** `channelGroupId = 5023d43f-5d40-494b-b024-1fad53e8338a` — from the capture.
  - Coffee Morning Dance `25060fe9-…`, p26-barcelona `80fc23c3-…` (from capture notes).
- **channel id ≠ channelGroupId.** The `/channels` endpoint returns channel ids/names/status (THROWBACK `04dcc60a…`, JACKIES `322236d8…`) but **not** the channelGroupId. Therefore the reliable programmatic resolution of a brand → WABA is: **read any existing template in the brand's project and take its `channelGroupIds`.** `resolveChannelGroup(projectId)` implements exactly this.
- **A project gains access to a WABA** by having templates deployed against that channelGroupId (the UI binds them). There is no obvious standalone "attach WABA to project" call; we sidestep it by shipping into a project that already has that WABA (e.g. Throwback → `08bab722`).
- **Projects listing:** `GET …/projects?limit=100` works; `limit=200` → **422** (max page size ≈ 100).

## f) Risk register

| Risk | Likelihood | Impact | Mitigation / alarm |
|---|---|---|---|
| Bird changes the internal POST shape | Medium (undocumented) | High — creation breaks | Full request+response logging on non-2xx (error codes `BIRD_TPL_*`); GET a known template in a healthcheck to detect shape drift; this audit is the rollback reference. |
| `AccessKey` scope revoked / rotated | Low | High | `isBirdAuthErrorStatus` (401/403) surfaces a clear "re-mint key" error. |
| Meta approval-queue pollution from probes | Medium | Medium | Draft-only probes (no channelGroup) + mandatory delete + 20-create cap. |
| Duplicate template names collide | Medium | Low | Idempotency: `listTemplates` → skip if `whatsappTemplateName` already exists in project. |
| `es-ES` vs `es_ES` locale mismatch | Medium | Medium — Meta rejects | Bird stores `es-ES` (hyphen). Builder normalises `es_ES` → `es-ES`. |
| Media URL rejected at create (JWT-signed nest URL) | Medium (Jackies sample) | Medium | Fallback: upload poster to a Bird media endpoint and use `media.api.bird.com` URL. |
| Shared block-id reuse across locales breaks if unique required | Low | Low | Follow observed behaviour (reuse per-role id across locales); probe confirms. |

---

## Probe log (Phase 2)

**Budget used: 7 template creates** (cap 20) + ~3 project creates. **Every create was deleted/withdrawn (all DELETEs → 204).** **Zero templates ever reached `pending_approval` or Meta** — all stayed `draft` (see U8). No production-brand data touched; probes used a fresh `_test_probe_delete_me` project or the pre-existing throwaway `test` project (`d6dd63a5…`). Raw request/response log: `.scratch/probe-log.jsonl`.

| Probe | Target | Result |
|---|---|---|
| 1/1b | U6 project create | `POST /workspaces/{wid}/projects` needs `{name, type:"channelTemplate"}` (`displayName`/`locales`/`supportedPlatforms` unsupported at create) → **201**. `DELETE /projects/{id}` → **204**. Fresh project has `approvedTemplateChannelGroupIds: undefined`. |
| 2 | U1,U2,U3,U7 draft template | Create **without** `channelGroupIds`, multi-locale (en+es-ES), 1 var + button → **201**, `status:"draft"`, `approvals` empty. `GET …/{id}` → 200. `DELETE …/{id}` → 204. **AccessKey works for create.** |
| 3 | U5 submit-with-CG | Create **with** `channelGroupIds` (Jackies) → **201 but still `status:"draft"`**, empty `approvals`/`platformInfo`. Deleted. |
| 4 | U8 publish sub-routes | `POST …/{id}/{publish,deploy,submit,activate,deployments,approvals,versions}` and `PUT …/{id}` all → **422 "no matching operation was found"** (routes absent). |
| 5 | U5 async? | Created with CG, polled 32s → stayed `draft` the whole time. **Not async.** Deleted. |
| 6 | U8 alt discovery | `OPTIONS` returns no `Allow` header. **`PATCH …/{id}` → 200** (templates are editable via PATCH). `POST {ws}/channel-template-deployments` → 404; project-scoped variants → 422 "no matching operation". |
| 7 | U8 deploy resource + PATCH-deploy | `channel-template-deployments` (all body shapes) → 422 "no matching operation" (**route absent**). PATCH-adding `channelGroupIds` to `platformContent` → 200 but stayed `draft`. |
| — | **Decisive** | **Exact replica of Matas's 201 capture** (no vars, static body, Jackies CG, `shortLinks:true`) → **201, `status:"draft"`, stayed draft after 10s.** |

### Resolutions

- **U1 ✅** `AccessKey` auth works for create (and GET/PATCH/DELETE). The capture's SSO JWT is not needed.
- **U2 ✅** `channelGroupIds` is **optional** at create. Omitting it (or including it) both yield a **local `draft`** — a create **never** submits to Meta. This makes programmatic create **completely safe** (no approval-queue impact).
- **U3 ✅** `variables[]` create shape: `{key, type:"string", format:"none", description, examplesLocale:{<locale>:{exampleValueStrings:[…]}}}`. Blocks reference `{{key}}` by name.
- **U4 ✅** Category lives in `deployments` (`{key:"whatsappCategory", platform:"whatsapp", value:"MARKETING"|"UTILITY"}`), not top-level.
- **U5 ✅** Where approval status lives (from the live approved Throwback template): per-locale `platformContent[i].approvals[]` (`status`, `platformStatus:"whatsapp_approved"`, `reasonCode`, `platformReference` = Meta template id) **and** aggregate `platformInfo["whatsapp:{platformAccountIdentifier}:{locale}"]` (`status`, `category`, `qualityRating`). Poll either via `GET …/channel-templates/{id}`.
- **U6 ✅** Projects **can** be created via API (`{name, type:"channelTemplate"}`).
- **U7 ✅** `DELETE …/channel-templates/{id}` → 204; `DELETE …/projects/{id}` → 204.

### ⛔ U8 — BLOCKER: publish / submit-to-Meta action is undiscovered

A create only produces a **draft**. Transitioning `draft → pending_approval` (which starts Meta's 24-48h clock) is a **separate action** the Studio UI performs that is **not in the provided capture**. It is not: a sub-route of `channel-templates`, a PUT/PATCH status change, an async background job, or a `channel-template-deployments` resource (all disproven above).

**To unblock:** need a DevTools capture of the Studio **"Submit for approval" / "Publish"** click (Network tab, the request fired when a draft is submitted). With that one capture, `publishTemplate()` drops straight into the client and the CLI's `--submit` flag becomes live. Until then, the tool creates fully-formed drafts and submission is a one-click step in Bird Studio per template.

### Project / draft model (discovered during ship)

- **A project holds only ONE draft at a time.** Creating a second draft in a project that already has one → **422 `{"status":["A draft item already exists in this project"]}`**. A project may hold many *active* templates, but only one work-in-progress draft.
- Consequently the workspace (and this tool) uses **one project per template**, named after the template's `whatsappTemplateName`. This matches Matas's existing layout (projects named `throwback_presale_live`, `jackies_opening_…_autoresponder`, etc.). The runner finds-or-creates `{template_name}` and stages the single draft there; idempotency skips if the template already exists in that project.

### Templates shipped (drafts) — 2026-07-01

| Template | Category | Locales | Bird template id | Project id |
|---|---|---|---|---|
| `throwback_autoresp` | UTILITY | en, es-ES | `2f0db67d-7823-4ac4-9a48-19d3454c93a7` | `f8e4e0e5-41ef-4073-b050-0ebdd6b8c766` |
| `throwback_presale_reminder` | MARKETING | en, es-ES | `d09973c1-6c61-4cab-95bd-0502e80d1190` | `9ee48546-1ae4-44b0-b105-0918a43fa167` |
| `jackies_presale_live` | MARKETING | es-ES | `024b8706-26ee-4322-9b83-281f6f985930` | `01cd061c-7d56-453c-8dc1-08e604e3cac3` |
| `jackies_autoresp` | UTILITY | es-ES | `fe00fdaa-2b68-4cf7-9913-855a9cdf4659` | `2818faaf-1433-4983-a579-cba8c3b410ea` |
| `jackies_presale_reminder` | MARKETING | es-ES | `02d9b563-6944-4041-816d-b21db691f754` | `b7314a0b-3ce9-4130-93be-7470aa2279e5` |

All are `status: draft` with the brand WABA attached — **submit each in Bird Studio** (one click) to start Meta's 24-48h clock. Re-running the CLI is a no-op (idempotent skip, verified).
