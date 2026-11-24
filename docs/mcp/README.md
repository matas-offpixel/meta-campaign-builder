# Off/Pixel MCP: adding and removing the Claude connector

The Off/Pixel MCP lets Claude read the app on your behalf, from the web or your phone. It uses the app's own Meta, TikTok and Google logins, so it also covers ad accounts the public Meta connector refuses.

**M1 is read-only.** It never writes to Meta, TikTok, Google, Slack or D2C, and every call is logged.

Plan: `scratch/mcp/mcp-v1-plan.md`.

## Before you start

You need all three of these:

- `ENABLE_MCP=1` on the Vercel deployment. Matas sets it; it must be exactly `1`. With anything else, every MCP and OAuth address answers 404. Unsetting it is the kill switch: it stops every connection at once.
- Migration `268_mcp_actions.sql` applied. It holds the OAuth store and the action log.
- An account on `OPERATOR_USER_IDS` (`lib/auth/operator-allowlist.ts`): Matas and the agency staff account. Nobody else can connect.

## Add the connector (do this on the web)

1. Open **claude.ai → Settings → Connectors** (claude.ai/customize/connectors) and choose **Add custom connector**.
2. **Name:** `Off/Pixel`. **URL:** `https://app.offpixel.co.uk/api/mcp`.
3. Leave **Advanced settings** as they are. Claude registers itself; there is no client ID or secret to paste.
4. Press **Add**, then **Connect**. A window opens on `app.offpixel.co.uk/oauth/authorize`:
   - **If it asks you to sign in:** sign in to Off/Pixel (the password login works in that window). Then go back to Claude and press **Connect** again.
   - **Otherwise:** check it says **Connect Claude to Off/Pixel** with your email, then press **Allow**.
5. You're back in Claude, and the connector shows as connected. Its eight tools are all marked read-only:
   - `morning_topline`
   - `list_events`
   - `get_event`
   - `get_campaign_tree` (says "not available yet" until #1364 merges)
   - `get_learnings`
   - `get_drafts`
   - `get_draft`
   - `run_launch_checks` (says "not available yet" until #1361 merges)

## On your phone

Add it on the web first. Anthropic's docs only describe adding connectors there. Once added, it shows up in the iOS and Android apps on the same account. Turn it on in a chat from the tools menu, then ask something like "morning topline" or "how is NX26-DOD doing?".

Claude can run read-only tools without asking each time. You can change that per tool in the connector's settings: **Always allow**, **Needs approval** or **Blocked**.

## How long it stays connected

- **Access token:** lasts an hour. Claude refreshes it by itself.
- **Refresh token:** each one lasts 30 days and is replaced every time it's used, so a connector used daily stays connected.
- **When you're asked to connect again:** the connector was left unused for 30 days, or it was revoked. Press **Connect** and **Allow** again.

## Remove or revoke it

Any one of these stops it:

- **In Claude:** go to **Settings → Connectors → Off/Pixel**.
  - **Disconnect** signs Claude out; **Connect** brings it back.
  - **Remove** deletes the connector.
- **From the app side, one person or everyone** (needs the service-role key in `.env.local`):

  ```bash
  npx tsx --env-file=.env.local scripts/mcp-revoke.mts --list
  ```

  ```bash
  npx tsx --env-file=.env.local scripts/mcp-revoke.mts --user <user uuid> --apply
  ```

  ```bash
  npx tsx --env-file=.env.local scripts/mcp-revoke.mts --all --apply
  ```

  Without `--apply` it only prints what it would revoke. The connector's next call gets 401.
- **Remove someone from `OPERATOR_USER_IDS`:** their next call is refused (403), and their next refresh revokes the grant.
- **Unset `ENABLE_MCP`:** everything answers 404 straight away.

## What is checked on every call

- `ENABLE_MCP === "1"`.
- **The bearer token:** it is opaque and stored only as a SHA-256 hash. It must be unexpired and unrevoked, and issued for `https://app.offpixel.co.uk/api/mcp`.
- **The user** is still in `OPERATOR_USER_IDS`.
- **The rate limit:** 60 calls a minute and 600 an hour, per connection.

Every tool call is one `mcp_actions` row: the tool, its arguments with secrets stripped, the user, the duration, the result size and any error. No token is ever logged.

**Later scopes:**
- `mcp:draft` (M2) will be for operators.
- `mcp:meta` (M3: Meta writes) and setting client spend ceilings will be for `MATAS_USER_IDS` only.
- M3 writes run request-then-confirm on the server: a write is stored as `requested` and runs only after you approve it on Today. The Claude prompt is never the record.

## Running it locally

```bash
ENABLE_MCP=1 MCP_DEV_TOKEN_STORE=memory npm run dev
```

`MCP_DEV_TOKEN_STORE=memory` keeps the OAuth store in memory, so the server runs against a database without migration 268. It is refused on Vercel. With it, the action log prints one counts-only line per call to stdout.

Point any MCP client at `http://localhost:3000/api/mcp`. It registers with a loopback redirect (`http://localhost:<port>/…`), and the consent page needs you signed in locally as an operator.
