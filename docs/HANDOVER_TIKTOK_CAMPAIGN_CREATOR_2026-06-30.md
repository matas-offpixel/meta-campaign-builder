# Handover — TikTok Campaign Creator thread

**Date:** 2026-06-30
**From:** Commercial+Ops thread (Matas)
**To:** TikTok Campaign Creator Cowork thread
**Surface owned:** TikTok wizard at `/clients/[id]/tiktok-campaign-creator/*`, all `lib/tiktok/*` write paths (excluding read-side reporting which belongs to Creator+Reporting)

## TL;DR

Tonight Matas tried to test the TikTok Campaign Creator wizard against Ironworks. The Account Setup step is blocked by an **identity_type enum bug** that's making the identity dropdown empty for every advertiser. The manual override field works (deliberate escape hatch). This thread's first job is fixing the bug + verifying the full 8-step wizard end-to-end. There's also a separate but related set of strategic considerations from a TikTok announcement tonight worth your attention.

## The blocking bug — TikTok identity_type enum

### Symptom

On `/clients/[Ironworks]/tiktok-campaign-creator` → Account Setup step, after selecting the Ironworks advertiser (TikTok ad account `7639802149165301776`), the TikTok identity dropdown shows this error:

> *"TikTok identity API returned: identity_type: value is not one of the allowed values, value is PERSONAL_HUB, correct is AUTH_CODE, BC_AUTH_TT, CUSTOMIZED_USER, TT_USER. Use manual override below."*

The dropdown is empty. The wizard's next button is disabled until either an identity is picked or the manual override is filled.

### Root cause (verified via grep tonight)

`lib/tiktok/identity.ts`:

```
line 3:  export type TikTokIdentityType = "PERSONAL_HUB" | "CUSTOMIZED_USER" | "TT_USER";
line 27: ["PERSONAL_HUB", ...]   ← iteration starts here
```

The code iterates over identity types calling TikTok's identity endpoint once per type. **`PERSONAL_HUB` is first AND not a valid identity_type per TikTok's API.** TikTok returns 400 with an explicit list of valid values: `AUTH_CODE`, `BC_AUTH_TT`, `CUSTOMIZED_USER`, `TT_USER`. Because the iteration short-circuits on first error (presumably), the dropdown never gets populated for any advertiser.

### Why this matters for the agency

This blocks the wizard's primary auto-resolve path for **every TikTok client**: Ironworks, Junction 2, Black Butter. The manual override escape hatch keeps the wizard usable, but every advertiser selection now needs a manual paste from TikTok Ads Manager. That's the kind of friction the wizard exists to eliminate.

### The fix

Single-file edit + regression test:

1. `lib/tiktok/identity.ts`:
   - Update `TikTokIdentityType` union: `"AUTH_CODE" | "BC_AUTH_TT" | "CUSTOMIZED_USER" | "TT_USER"`.
   - Remove `"PERSONAL_HUB"` entirely.
   - Update iteration array to `["BC_AUTH_TT", "AUTH_CODE", "CUSTOMIZED_USER", "TT_USER"]`. **Order matters** — `BC_AUTH_TT` is the most common (Business Center linked identities = what every Off Pixel client uses). Putting it first means fastest happy path.
2. Audit for `PERSONAL_HUB` elsewhere: `lib/tiktok/*`, `app/api/tiktok/*`, migrations (CHECK constraints). `lib/tiktok/share-render.ts` references `identity_type` as a DB string, not the enum, so probably no change needed but confirm.
3. Add regression test in `lib/tiktok/__tests__/identity.test.ts` asserting the 4 valid values and the order.
4. Manual override stays. Even after the fix, edge-case advertisers will need it — TikTok identity API has known account-state quirks.

**Important DO NOTs:**
- Do not touch the TikTok write API path. `OFFPIXEL_TIKTOK_WRITES_ENABLED` stays off; this fix is wizard draft-creation only.
- Do not remove the manual identity override field.
- Do not invent a CHECK constraint migration unless one actually exists — verify first.

A drafted Cursor prompt for this fix already exists at `docs/cursor-prompts/TIKTOK_IDENTITY_TYPE_FIX_2026-06-30.md`. It's Sonnet-shaped but could be Claude Code (single-file mechanical fix). Either is fine.

## State of the wizard (where you're inheriting it)

### What's shipped and live

The wizard is at `app/(dashboard)/clients/[id]/tiktok-campaign-creator/*` (or similar — grep for "TikTok Campaign Creator" to confirm). 8 steps:

1. Account setup — advertiser + identity + pixel
2. Campaign setup
3. Optimisation strategy
4. Audiences
5. Creatives
6. Budget & schedule
7. Assign creatives
8. Review & launch

The launch step has a hard-disable until TikTok write APIs are enabled, per the visible message *"Launch remains disabled until TikTok write APIs are enabled."* That's gated on `OFFPIXEL_TIKTOK_WRITES_ENABLED` and a TikTok account-level approval that's separate from any code change. Drafts can be created and saved; pushing to TikTok is what's blocked.

### Related infrastructure already shipped

A lot of TikTok-side groundwork is live and load-bearing — read these before adding new code:

- `tiktok_accounts` table — encrypted credential storage per client (migration 054).
- `tiktok_active_creatives_snapshots` — cron-populated per-advertiser snapshot for the share-report (migration 057). Currently sparse on most accounts because of the cron eligibility gates (see warnings below).
- `tiktok_campaign_drafts` + `tiktok_campaign_templates` — the wizard's persistence layer (migration 058).
- `tiktok_rollup_breakdowns` — daily aggregated metrics per advertiser (migration 059).
- `tiktok_write_idempotency` — write-API idempotency keys, ready for activation (migration 062).
- `lib/tiktok/share-render.ts` — read path for share-report. **Don't touch this** unless write-side coordination is happening.

### Known TikTok platform gotchas — read these before reasoning about API behaviour

Several have been hard-won during the Ironworks build:

1. **`credentials.advertiser_ids[0]` lies.** Returns the first advertiser across the entire OAuth scope, NOT the configured account. Silent failure: cron logs `ok:true, rows:0`. Always read `tiktok_accounts.tiktok_advertiser_id` from DB. Ironworks hit this. Black Butter and J2 still need audit (task #13 elsewhere).

2. **Metric field validation is atomic.** A single invalid field name in the metric list 400s the entire `/ad/get/` or `/report/integrated/get/` call. Test the full request payload when adding new fields. We hit this with `thumbnail_url` / `preview_url` and `view_content`.

3. **Spark Ads vs push-content ads use different endpoints.** Push-content ads (`AMAAD_*`) resolve via `/file/video/ad/info/`. Spark Ads (`VID 1/2/3`, long-copy ads riding on organic posts) reference `tiktok_item_id` + `identity_id` + `identity_type` instead, and the Marketing API has **no accessible endpoint to fetch the post info**. We resolve via the public OEmbed endpoint (`oembed.tiktok.com`) with a `Mozilla/5.0` User-Agent header — bare Node fetch is blocked.

4. **TikTok public video URL format matters.** `tiktok.com/video/{id}` 404s. Correct: `tiktok.com/@{username}/video/{id}`. There's outstanding debt to fix this in the cron writer — currently SQL-patched (task #16).

5. **`brand_campaign` cron eligibility has 4 silent gates.** brand_campaign needs `event_start_at` AND `campaign_end_at` populated (window resolver) AND `tiktok_account_id` linked AND campaign names containing the event_code substring. All four must be true for the snapshot cron to fire. [IRWOHD] confirmed failing gate 1 (event_start_at NULL) as of early June. No working brand_campaign cron precedent on Black Butter either.

### Memory files in the project_creator namespace worth reading

These are the project memories that document the above:

- `project_tiktok_snapshot_table_systemically_empty_2026-05-26` — why the snapshot table has been mostly empty across the DB.
- `project_tiktok_brand_campaign_cron_eligibility_gates` — the 4-gate problem.
- `project_creator_tiktok_advertiser_id_default_trap_2026-06-03` — the `advertiser_ids[0]` silent-failure trap.
- `project_creator_tiktok_spark_ad_oembed_workaround_2026-06-03` — Spark Ad thumbnail OEmbed pattern + username-prefix requirement.

## Outstanding tasks affecting this thread

From the Commercial+Ops thread's tracker (use these as priority signal, not your own backlog):

- **#13 — Audit TikTok advertiser ID on Black Butter + Junction 2 crons.** PR #518 fixed Ironworks. Verify BB and J2 are reading the stored DB value, not `credentials.advertiser_ids[0]`. Silent-zero is the worst possible cron failure mode.
- **#15 — Document Spark Ad OEmbed pattern in `project_creator` memory.** Drafted but not saved. Worth saving so the next agent session doesn't re-discover it.
- **#16 — Roll TikTok username-prefix fix into cron writer.** Currently SQL-patched only; will regress on next cron rewrite.
- **#36 — 5 remaining IRW000X Mailchimp tags auto-fire on Meta campaign launch.** Adjacent to your surface because Ironworks event launches are the first to use the full TikTok wizard flow.
- **#53 — TikTok identity_type enum bug (this handover's headline).** Drafted prompt at `docs/cursor-prompts/TIKTOK_IDENTITY_TYPE_FIX_2026-06-30.md`.

## Strategic context — TikTok for Business MCP + Agentic Hub

Tonight (2026-06-30) TikTok announced two things that may affect your medium-term roadmap:

1. **TikTok for Business MCP** — an MCP server exposing TikTok ads capabilities (campaign management, creative management, catalog, reporting, account ops) to AI agents. Could in theory replace our custom TikTok layer (`lib/tiktok/*`, the OAuth flow, etc.) with calls through a standardised MCP interface.

2. **Agentic Hub** — TikTok's marketplace for AI Skills built on the MCP. Companies like HubSpot, Wix, MADHOUSE etc. are publishing skills. The strategic question for Off Pixel is whether publishing a skill (e.g. "agency operational dashboard for TikTok event campaigns") would drive inbound lead-gen from advertisers browsing the marketplace.

**My honest recommendation, carried over from the Commercial+Ops thread for the record:**

- **Don't replace the internal TikTok layer with the MCP.** The custom layer handles edge cases the MCP won't (Spark Ad OEmbed, advertiser-ID trap, username prefix, brand_campaign eligibility gates). 6 weeks of hard-won operational knowledge lives in those code paths. Switching to MCP means rediscovering those quirks through someone else's abstraction, plus accepting whatever maintenance lag TikTok introduces.
- **Do investigate publishing a skill** — but at Friday-with-Sarah pace, not as urgent build work. Read the TikTok Business MCP docs + the publish-skills doc first to confirm the model works for a 2-person agency (it's likely designed for HubSpot-scale operations).

Task #52 in the Commercial+Ops tracker captures this as a Friday investigation, not action.

## Hard rules for this thread

Carried from `CLAUDE.md` + memory:

1. **Branch naming:** `cursor/creator/<feature>` for Cursor; `cc/creator/<feature>` for Claude Code single-file fixes. Never edit files on the other tool's branch.
2. **One PR per branch.** No follow-up commits to a merged branch.
3. **Run `git checkout main && git pull --ff-only` before opening any new branch.**
4. **Wait ~90s between merging PRs.**
5. **Session log per PR.** `docs/session-logs/pr-{N}-{branch}.md` per `docs/SESSION_LOG_TEMPLATE.md`, committed in the same PR.
6. **TikTok write API stays off until `OFFPIXEL_TIKTOK_WRITES_ENABLED` is flipped.** That flip is a Commercial decision tied to a TikTok-side approval; don't flip it from this thread without explicit Matas sign-off.
7. **Don't touch the share-render path** (`lib/tiktok/share-render.ts`) — the Creator+Reporting thread owns it.
8. **For diagnostic logs in TikTok crons/routes use `console.error`** (Vercel filters `console.log/warn` under load).
9. **The manual identity override field is a deliberate fallback.** Even after the enum fix, don't remove it.

## First message this thread should ask

The TikTok thread should open with one of these, not assume context:

1. **"Has Matas done the Ironworks wizard smoke test using the manual identity override yet?"** — Affects whether the wizard's other steps (audiences, creatives, budget, review) have their own bugs that surface only after the identity bug is bypassed.
2. **"What's the priority — enum fix first, or audit BB + J2 advertiser-IDs first?"** — Default is enum fix because Matas hit it tonight. Override if Black Butter has an event launch pending.
3. **"Are there any TikTok account-level state changes (BC links, identity re-auths) the user knows about that might explain why PERSONAL_HUB was a sane assumption when this code was written?"** — Useful context. Sometimes PERSONAL_HUB *was* a valid identity_type at an earlier point in TikTok's API and was deprecated.

Don't start coding without those three answers — at minimum confirm #1.

---

## TL;DR for the agent picking this up

You're inheriting the TikTok Campaign Creator wizard. Tonight Matas tried to test it and hit a deterministic enum bug in `lib/tiktok/identity.ts` (`PERSONAL_HUB` is invalid). Fix that first — drafted prompt at `docs/cursor-prompts/TIKTOK_IDENTITY_TYPE_FIX_2026-06-30.md`.

Then complete the manual Ironworks smoke test of all 8 wizard steps. Surface anything else that's broken.

The TikTok write API stays off until separate approval. Drafts are testable now.

Read `CLAUDE.md`, the `project_tiktok_*` memories, and the Mailchimp + Ironworks handovers before scoping any follow-up architectural work. There's a lot of hard-won quirk-handling already in the codebase; respect it.
