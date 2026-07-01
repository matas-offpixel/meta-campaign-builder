# D2C Mailchimp template automation

Programmatic creation of Mailchimp email templates, reusable across brands.
Mirrors the Bird templates architecture (`docs/D2C_BIRD_TEMPLATE_AUTOMATION.md`)
but against Mailchimp's **publicly documented** Marketing API v3 — no
reverse-engineering.

- **Code:** `lib/d2c/mailchimp/templates/`
- **CLI:** `scripts/d2c/ship-mailchimp-templates.ts`
- **Admin route:** `POST /api/admin/d2c/mailchimp-templates`
- **Credentials seed:** `scripts/d2c/seed-jackies-mailchimp-connection.ts`
- **API docs:** https://mailchimp.com/developer/marketing/api/

---

## Architecture

| Layer | File | Role |
|---|---|---|
| Types | `templates/types.ts` | Wire shapes + declarative `MailchimpTemplateDefinition` + validators + merge-tag extractor |
| Client | `templates/client.ts` | Typed v3 client on the shared `mailchimpJson` helper (Basic auth, 20s timeout, 1×5xx retry) |
| Builder | `templates/builder.ts` | Pure: definition → Outlook-safe **inline-styled** HTML with `*\|VAR\|*` merge tags |
| Definitions | `templates/definitions/{jackies,throwback}.ts` | Declarative brand data, 5 kinds each |
| Runner | `templates/runner.ts` | Idempotent ship loop (shared by CLI + admin route) |

**Template kinds (5):** `announcement`, `presale_reminder`, `presale_live`,
`autoresp`, `gen_sale`.

**Merge tags:** `*|EVENT_NAME|*`, `*|EVENT_DATE|*`, `*|PRESALE_DAY|*`,
`*|PRESALE_TIME|*`, `*|GEN_SALE_DAY|*`, `*|GEN_SALE_TIME|*`, `*|TICKET_URL|*`,
`*|WA_COMMUNITY_URL|*`, `*|ARTWORK_URL|*`, `*|EVENT_VENUE|*`, `*|EVENT_CITY|*`.
Event-level values are substituted at campaign-content time by the orchestration
layer; audience-level tags (`*|UNSUB|*` etc.) are Mailchimp-native.

---

## CLI

```bash
node --experimental-strip-types scripts/d2c/ship-mailchimp-templates.ts \
  --brand jackies [--templates announcement,presale_live] \
  [--client-id <uuid>] [--dry-run] [--api-key-env-var JACKIES_MAILCHIMP_API_KEY]
```

- `--dry-run` builds HTML + prints subjects; no API calls.
- Idempotency: templates are skipped by **name** if already in the account.

### Shipped 2026-07-01 (Jackies, dc us7)

| Template | Mailchimp id |
|---|---|
| jackies_announcement | 13698993 |
| jackies_presale_reminder | 13698994 |
| jackies_presale_live | 13698995 |
| jackies_autoresp | 13698996 |
| jackies_gen_sale | 13698997 |

> **Throwback templates are defined but not yet shipped** — no
> `THROWBACK_MAILCHIMP_API_KEY` exists yet. Add the key (or seed a Throwback
> `d2c_connections` row) then run `--brand throwback`.

---

## Credentials (Phase 3)

Resolution order (`lib/d2c/mailchimp/credentials.ts`):

1. **`d2c_connections`** row for `(client_id, provider='mailchimp')`, decrypted
   via the `get_d2c_credentials` RPC (migration 042). Production source of truth.
2. **Env var** fallback (`JACKIES_MAILCHIMP_API_KEY`) — **local dev only**, logs
   a warning.

Seed the encrypted connection once (never enables live sends — `live_enabled`
and `approved_by_matas` stay `false`):

```bash
node --experimental-strip-types scripts/d2c/seed-jackies-mailchimp-connection.ts
# requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, D2C_TOKEN_KEY,
# JACKIES_MAILCHIMP_API_KEY
```

A Mailchimp key is `<key>-<dc>` (e.g. `…-us7`); the datacenter suffix is also the
server prefix. `parseMailchimpApiKey()` splits it.

---

## Adding a brand / template

1. Add a `MailchimpBrandConfig` in `templates/definitions/<brand>.ts` (theme +
   templates) and register it in `definitions/index.ts`.
2. New template kind: extend `MailchimpTemplateKind` in `types.ts` (and the
   orchestration channel map if it should send).
3. `npm run build` + the builder unit test must stay green.

---

## Rollback

Mailchimp templates are inert until a campaign references them, so shipping is
safe. To remove: `deleteTemplate(cfg, id)` (or the Mailchimp UI). The
env-fallback path means removing a `d2c_connections` row degrades to local-dev
behaviour rather than breaking, as long as the env var is present.
