# D2C Bird Studio template automation

Programmatic creation of Bird Studio WhatsApp message templates, reusable across
brands. Turns declarative brand definitions into Bird-shaped drafts via a typed
client + fluent builder, with a CLI and an admin API trigger.

- **Code:** `lib/d2c/bird/templates/`
- **CLI:** `scripts/d2c/ship-bird-templates.ts`
- **Admin route:** `POST /api/admin/d2c/bird-templates`
- **Reverse-engineering audit (ground truth):** `docs/audits/D2C_BIRD_TEMPLATES_API_AUDIT_2026-06-30.md`

---

## ⚠️ Internal-API caveat + fragility

This uses Bird's **internal Studio** endpoint
`POST /workspaces/{wid}/projects/{pid}/channel-templates` — the request the
Studio web UI fires. **It is not publicly documented and can change without
notice.** All shapes here were verified empirically (DevTools capture + live
GET/POST probes). If Bird changes the payload, creation breaks.

**Fragility guards in place:**
- Every non-2xx surfaces via `BirdHttpError` with the full response body, and
  the runner tags each failure with an error code (`BIRD_HTTP_<status>`,
  `BIRD_TPL_*`) for fast triage.
- A live GET of a known template (see the audit) is the canonical shape
  reference — diff against it if creation starts 422-ing.
- The builder is pure + unit-tested, so payload regressions fail in CI, not prod.

**Auth:** long-lived `AccessKey` (`BIRD_API_KEY`) — confirmed working on this
endpoint (the DevTools capture's SSO JWT is *not* required). Requests go through
`lib/d2c/bird/client.ts` (AccessKey header, 20s timeout, 5xx retry).

## Architecture

```
definitions/{brand}.ts   declarative BrandTemplateDefinition[]  (data only)
        │
        ▼
builder.ts               buildTemplatePayload(def, opts) → Bird POST payload  (pure)
        │
        ▼
client.ts                typed create/get/list/delete + project ops           (I/O)
        │
        ▼
runner.ts                shipBrandTemplates() — idempotent, one project/template
        ├── scripts/d2c/ship-bird-templates.ts    (CLI)
        └── app/api/admin/d2c/bird-templates       (admin POST)
```

- **Variables** use named `{{var}}` tokens directly in body/footer/button-url and
  the header image var. Bird Studio uses the same named scheme, so tokens pass
  through verbatim and are declared in `variables[]` with per-locale examples.
- **Locales**: definitions use `es_ES`; the builder normalises to Bird's `es-ES`.
  Multi-locale = one template with one `platformContent` entry per locale (shared
  block ids). The first entry carries the header media `type`; the rest are `null`.

## Running the CLI

```bash
set -a && source .env.local && set +a && \
  npx tsx scripts/d2c/ship-bird-templates.ts --brand throwback
# also works: node --experimental-strip-types --env-file=.env.local scripts/d2c/ship-bird-templates.ts --brand throwback
```

Flags: `--brand <key>` (required), `--dry-run`, `--locales en,es_ES`,
`--templates name1,name2`, `--no-channel-group` (create pure drafts with no WABA),
`--submit` (currently reports `publish_unsupported` — see below).

Admin route (same options as JSON), gated by a Matas session (`MATAS_USER_IDS`)
or `Authorization: Bearer <CRON_SECRET>`:

```bash
curl -X POST https://<host>/api/admin/d2c/bird-templates \
  -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
  -d '{"brand":"jackies","dryRun":true}'
```

## Adding a new brand

1. Create `lib/d2c/bird/templates/definitions/<brand>.ts` exporting a
   `BrandTemplateDefinition[]` (copy an existing file). Every `{{var}}` you use
   must have a `variableExamples[var][locale]` entry — the builder validates this.
2. Register it in `definitions/index.ts` under `BRANDS`:
   ```ts
   mybrand: { key: "mybrand", channelGroupId: "<WABA channel group id>", templates: mybrandTemplates }
   ```
3. Find the brand's **WABA channel group id** by GET-ing any existing template in
   one of the brand's projects and reading `platformContent[].channelGroupIds`
   (or the project's `approvedTemplateChannelGroupIds`). `resolveChannelGroup()`
   does this automatically for pre-existing projects.
4. `projectId` is optional and generally omitted — the runner creates one
   project per template named after the template (see idempotency).

## Adding a new template type

Add an entry to the brand's definitions array: `name` (lower snake_case),
`category` (`MARKETING`/`UTILITY`/`AUTHENTICATION`), `locales`, per-locale `body`
(+ optional `footer`, `button`), and `variableExamples` for every referenced var.
Set `headerImageVar: null` to omit the image header. That's it — the builder and
runner pick it up.

## Idempotency contract

- The runner uses **one Bird project per template**, named after the template's
  `whatsappTemplateName` (Bird allows only one *draft* per project).
- Before creating, it calls `listTemplates` on that project and **skips** if a
  template with the same `whatsappTemplateName` already exists (any status),
  reporting `skipped_exists` with the existing id. Re-runs are safe no-ops.
- To intentionally replace a template, delete it in Bird Studio (or via
  `deleteTemplate`) first, then re-run.

## Meta approval status — where it lives + how to poll

A create yields a Bird **draft** (`status: "draft"`). After a draft is submitted
(see below), poll `GET /workspaces/{wid}/projects/{pid}/channel-templates/{id}`:

- **Aggregate:** `platformInfo["whatsapp:{platformAccountIdentifier}:{locale}"]`
  → `{ status, category, qualityRating }` (`status` goes `pending` → `active`/`rejected`).
- **Per-locale detail:** `platformContent[i].approvals[]` →
  `{ status, platformStatus:"whatsapp_approved", reasonCode, platformReference }`
  (`platformReference` is Meta's template id once approved).

Meta's review clock is typically 24-48h per locale.

## ⛔ Known limitation — publishing (submit-to-Meta) is manual

Programmatic **create** is solved; programmatic **submit-to-Meta is not yet**.
A create only stages a draft; the Studio "Submit for approval" action is a
separate request that was **not** in the reverse-engineering capture, and probing
did not reveal it (it is not a sub-route, PUT/PATCH status change, async job, or
deployments resource — see audit §U8). So today:

1. Run the CLI/route → drafts created (submit-ready, WABA attached).
2. Open Bird Studio → each draft → **Submit for approval** (one click).

**To automate submit:** capture the Studio "Submit for approval" network request
(DevTools → Network) and add a `publishTemplate()` to `client.ts`; the runner's
`--submit`/`submit` flag is already wired to call it (currently returns
`publish_unsupported`).

## Rollback / if Bird changes the API

- **Nothing is destructive by default** — the tool only creates drafts (idempotent)
  and never auto-submits. Drafts can be deleted in Studio or via `deleteTemplate`.
- If creation starts failing (422/shape drift): GET a known-good template, diff
  its shape against `types.ts`/the audit, and adjust the builder. The builder unit
  tests pin the expected payload.
- If auth fails (401/403): the `AccessKey` was rotated/scoped-down — re-mint
  `BIRD_API_KEY` in Bird settings and update the env var.
- To disable entirely: stop calling the CLI/route. There is no cron and no
  runtime dependency on this module elsewhere.
