# Off/Pixel MCP: adding and removing the Claude connector

The Off/Pixel MCP lets Claude read the app on your behalf, from the web or your phone. It uses the app's own Meta, TikTok and Google logins, so it also covers ad accounts the public Meta connector refuses.

**M1 reads; M2 changes drafts.** Neither writes to Meta, TikTok, Google, Slack or D2C, and every call is logged. M2's draft tools change campaign drafts in the app (status draft only); nothing launches or spends.

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
5. You're back in Claude, and the connector shows as connected. Its eight read tools are marked read-only (the sixteen draft tools are below):
   - `morning_topline`
   - `list_events`
   - `get_event`
   - `get_campaign_tree` (says "not available yet" until #1364 merges)
   - `get_learnings`
   - `get_drafts`
   - `get_draft`
   - `run_launch_checks` (the launch checks Review & launch shows, in the app's words)

## Draft tools (M2)

A connection made after M2 asks to **use** Off/Pixel, and the consent page says it can make, change and archive drafts that aren't published. A connection made before M2 can still read. The first time Claude calls a draft tool on it, the server answers `403 insufficient_scope` and Claude asks you to connect again: the page reads **Let Claude change drafts in Off/Pixel**. Cancelling keeps the read-only access. Allowing replaces it: once the new connection is issued, the read-only one is revoked, so the connector has one live grant. If that fails part way, the new connection is undone and Claude asks you to connect again.

The sixteen draft tools (scope `mcp:draft`, operators). M2's eight:

| Tool | What it does |
|---|---|
| `replicate_to_event` | Copies a draft (draft or published) to an upcoming event of the same client, as a new draft, re-deriving the event's account, pixel, link, dates and audiences. |
| `set_draft_link` | Sets every ad's link (or some ads'). https only; warns when it isn't the event's signup page or ticket link. |
| `set_draft_locations` | Adds a searched place, a pin or the Leeds preset; removes locations; tags tiers. Warns on Meta key 811209 (Leeds, Kent). The search is a Meta read. |
| `set_draft_budget` | Daily or lifetime in GBP, start and end. Refuses a past start or an end before the start. Returns the per-day equivalent. |
| `apply_audience_template` | The Audience templates tab's Add to this draft: the template's audiences already made in the draft's account go in by Meta id; the rest are left out and counted. Never creates audiences. Refuses a template Matas hasn't confirmed. |
| `list_drive_creatives` | One folder of the event's Drive tree, or (M3a) any folder elsewhere in the Off/Pixel shared drive (`outsideTree: true`; `root` is the drive's top): files with kind, aspect, size and whether each can be an ad on its own. Reads only. |
| `attach_drive_creatives` | Copies Drive files into Storage and adds ads (the client's page by default): `file_ids`, one ad per 9:16 file (any other aspect is refused with it); `pairs` (M3a), one ad per 4:5 or 1:1 feed file and its 9:16, both slots, Dual (the per-placement path). Files from the event tree or anywhere in the shared drive. No Meta upload until launch. Refuses artist-voice copy until caption approvals exist. |
| `archive_draft` | Moves a draft to the library's Archived tab. Unarchive there brings it back; nothing is deleted. |

M2b's eight, so a whole campaign can be built as a draft:

| Tool | What it does |
|---|---|
| `set_draft_objective` | The Campaign step's objective change: the goal, the suggested name (a hand-edited one is kept) and the pixel event follow; awareness clears Advantage+. |
| `set_draft_ad_sets` | Step 5's row edits (on/off, budget, name, ages, Advantage+), `add_broad` (blank, or one group as Advantage+ suggestions) and `assign_all`. Refuses any enabled ad set under £8 a day unless `override` with `override_reason`, which is logged. |
| `set_draft_audiences` | Remove, rename and merge groups (merged interests deduped); add interests by Meta's interest search (a read); add custom audiences the app recorded in the draft's account. Ad sets follow their groups. |
| `set_draft_identity` | The page (and Instagram) on the settings and every ad. Refuses a page the ad account can't run ads from (the page list, a Meta read). |
| `set_draft_copy` | Primary texts, headline, description and CTA on every ad or listed ones. Refuses artist-voice copy. |
| `remove_draft_creatives` | Drops ads and their assignments. |
| `set_draft_schedule` | Start and end (London) without touching budgets. Refuses a past start or an end before the start. |
| `duplicate_draft` | The library's Duplicate: a new draft on the same event, for a test's second arm. |
| `set_draft_name` | (M3a) The Campaign step's Campaign Name: what the library lists and Meta gets as the campaign name. |

Every draft tool except `replicate_to_event`, `list_drive_creatives` and `duplicate_draft` takes the draft's `updated_at` from `get_draft`; a draft changed since then is refused. Published and archived drafts are read-only here. Each answer carries the launch checks (runLaunchGuard: blockers and warnings in the app's words). The only requests that leave the app are three Meta reads: the location search, the interest search and the account's page list.

## Launch from the connector (M3a, `mcp:meta`, Matas only)

Matas ruled on 25 Nov that his typed yes in Claude is the approval for a Meta change through the connector (`scratch/mcp/m3-full-control-2026-11-25.md`). Every meta tool takes `approval: { asked, answer }`: the exact question Claude asked in chat and Matas's reply word for word, each 1 to 1,000 characters. Without it nothing runs. The pair is stored on the call's `mcp_actions` row (`args.approval`) with `approved_by`, `approved_at` and `approval_source = 'claude_prompt'`.

| Tool | What it does |
|---|---|
| `upload_draft_assets` | Standalone Launch's first step only: every file the draft holds in Storage goes to its ad account through the MML path (a file already on that account is not sent again) and the Meta ids are saved on the draft. No launch, no spend. A file Meta doesn't take is saved as "Upload failed — retry or remove"; calling again retries it. |
| `launch_draft` | The same step, then Review & Launch's route (`POST /api/meta/launch-campaign`). `mode: "paused"` passes the route's `createPaused`: the campaign, every ad set and every ad are created paused. `mode: "live"` creates them active, and is refused when the client has no ceiling or the draft's money a day is over it. Refused while runLaunchGuard or the wizard's step checks have a blocker. Answers the campaign, ad set and ad ids and the Ads Manager link. |
| `update_event` | The event form's save for announcement, presale and general sale times and the signup and ticket links. App database only. |

**Client ceilings** (`client_spend_ceilings`): a change that starts spend (a live launch now) is checked on the server against the client's daily £; no ceiling means refused. Paused launches, uploads, renames and event edits never read one. Until Settings › Claude ships, Matas sets them with `scripts/set-client-ceiling.mts` (`--list`; `--client <uuid|name> --daily <£>`, dry run unless `--apply`; `--remove`).

**Files at launch, in the app too:** a pending slot whose file is in Storage (from Drive or the connector) is no longer a launch blocker. Standalone Launch on `/campaign/[id]` sends those files first (`POST /api/meta/draft-assets`, the same step), shows "Launching…" throughout, and stops if one fails, with that slot reading "Upload failed — retry or remove". A pending slot with no Storage copy still reads "Asset not yet uploaded".

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

**Scopes:**
- `mcp:read` (M1) and `mcp:draft` (M2) are for operators.
- `mcp:meta` (M3a: launches, uploads to Meta, event edits) is for `MATAS_USER_IDS` only. Another operator's consent is issued with read and drafts; a meta call checks `MATAS_USER_IDS` again every time. Matas reconnects the connector once to add it.
- Meta changes run on Matas's chat yes (`approval`), per his 25 Nov ruling, which replaces TD1–TD2's Approve on Today. Today becomes the log (M3b).

## Running it locally

```bash
ENABLE_MCP=1 MCP_DEV_TOKEN_STORE=memory npm run dev
```

`MCP_DEV_TOKEN_STORE=memory` keeps the OAuth store in memory, so the server runs against a database without migration 268. It is refused on Vercel. With it, the action log prints one counts-only line per call to stdout.

Point any MCP client at `http://localhost:3000/api/mcp`. It registers with a loopback redirect (`http://localhost:<port>/…`), and the consent page needs you signed in locally as an operator.
