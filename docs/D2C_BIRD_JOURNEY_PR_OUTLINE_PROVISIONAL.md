# D2C Bird Journey automation — provisional PR outline

_2026-07-10. PROVISIONAL — drafted while a Matas-approved DevTools capture
(via Chrome MCP orchestration) is in flight to confirm the 3 remaining
unknowns. Nothing in this document is implemented; no files listed below
exist yet. Companion to `docs/D2C_BIRD_FLOW_AUTOMATION_INVESTIGATION.md`,
which this outline follows on from ("Candidate multi-call sequence")._

Every code block below is tagged **CONFIRMED** (live-probed, 2026-07-09/10,
see the investigation doc's appendix) or **TBD** (candidate shape, pending
the capture). Do not open a PR from this outline until every TBD is replaced
with a confirmed shape.

---

## 1. `lib/d2c/bird/journeys/client.ts` — the multi-call orchestration wrapper

Mirrors `lib/d2c/bird/campaigns/client.ts` (same `birdFetch`/`birdJson`
primitives, same idempotent-by-name pattern, same verified-flag convention as
`DRAFT_CAMPAIGN_VERIFIED`).

```typescript
/**
 * lib/d2c/bird/journeys/client.ts
 *
 * Typed client for Bird's Journey automation API — creates a per-event
 * "contact added to group -> send WhatsApp template" autoresponder,
 * replacing the manual per-event UI clone (92 live journeys today, many
 * literally named "(copy)").
 *
 * VERIFIED against docs/D2C_BIRD_FLOW_AUTOMATION_INVESTIGATION.md:
 *   1. CONFIRMED  POST /workspaces/{ws}/journeys { name } -> 201 inert shell
 *      (status:"requires-configuration", trigger:null, versionCount:0).
 *   2+3. TBD (refined 2026-07-10) -- likely ONE call, not two: a read-only GET
 *      on a real in-progress journey (Matas's own DevTools-capture object,
 *      not created by this agent) showed `trigger` lives on the *version*
 *      object alongside `definition`, not on the journey envelope (envelope's
 *      `trigger` stayed null even with a draft version present). Candidate:
 *      PATCH/PUT /journeys/{id}/versions/{vid} { trigger, definition } as a
 *      single write. Exact verb + whether the version's `editToken` must be
 *      echoed back (optimistic concurrency -- versions carry one) still TBD.
 *      Version auto-creation itself IS confirmed real (versionCount 0 -> 1
 *      once a journey is opened in the builder) -- just not yet known whether
 *      that's an explicit POST .../versions call or implicit on builder-open.
 *   4. TBD        publish        -- candidate PUT /journeys/{id}/versions/{vid}/publish
 *      (by analogy with the CONFIRMED PUT .../channel-templates/{id}/activate
 *      verb-suffix pattern in lib/d2c/bird/templates/client.ts)
 *
 * Steps 2-4 are placeholders pending a DevTools capture (in flight,
 * 2026-07-10). DO NOT call createOrUpdateAutorespJourney() from any live
 * code path until JOURNEY_CREATE_VERIFIED is flipped true.
 */

import { BirdHttpError, birdFetch, birdJson } from "../client.ts";

/** Flip true only once the capture confirms steps 2-4 below. */
export const JOURNEY_CREATE_VERIFIED = false;

export interface BirdJourneyClientConfig {
  apiKey: string;
  workspaceId: string;
}

export interface BirdJourney {
  id: string;
  name: string;
  status: string; // "requires-configuration" | "active" | "inactive" | ...
  trigger: unknown | null;
  draftVersion: string | null;
  publishedVersion: string | null;
  versionCount: number;
}

function journeysPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/journeys`;
}

function unwrapList<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    const r = (json as Record<string, unknown>).results;
    if (Array.isArray(r)) return r as T[];
  }
  return [];
}

export async function listJourneys(
  cfg: BirdJourneyClientConfig,
  limit = 100,
): Promise<BirdJourney[]> {
  const json = await birdJson<unknown>(
    cfg.apiKey,
    `${journeysPath(cfg.workspaceId)}?limit=${Math.min(limit, 100)}`,
    { method: "GET" },
  );
  return unwrapList<BirdJourney>(json);
}

/** Idempotency: never mint a duplicate journey for the same event. */
export async function findJourneyByName(
  cfg: BirdJourneyClientConfig,
  name: string,
): Promise<BirdJourney | null> {
  const target = name.trim().toLowerCase();
  const list = await listJourneys(cfg);
  return list.find((j) => j.name.trim().toLowerCase() === target) ?? null;
}

// --- Step 1: CONFIRMED (201, { name } only, returns an inert shell). ---
export async function createJourneyShell(
  cfg: BirdJourneyClientConfig,
  name: string,
): Promise<BirdJourney> {
  return birdJson<BirdJourney>(cfg.apiKey, journeysPath(cfg.workspaceId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

// --- Steps 2+3: TBD, REFINED 2026-07-10 — likely one call, not two. ---
// A read-only GET on a real in-progress journey (not created by this agent —
// see docs/D2C_BIRD_FLOW_AUTOMATION_INVESTIGATION.md's "read-only
// corroboration" note) showed `trigger` lives on the VERSION object next to
// `definition`, not on the journey envelope. So `attachTrigger` below is
// almost certainly the WRONG shape (a bare envelope PATCH) — the capture will
// likely show a single write to the version resource carrying both `trigger`
// and `definition` together. Kept as two separate candidate functions for now
// so the outline stays reviewable; expect this section to collapse into one
// `writeVersion(cfg, journeyId, versionId, { trigger, definition })` once the
// capture lands.
export interface AttachTriggerInput {
  groupId: string;
}
export async function attachTrigger(
  cfg: BirdJourneyClientConfig,
  journeyId: string,
  input: AttachTriggerInput,
): Promise<BirdJourney> {
  // TBD candidate — untested, and likely wrong per the note above (trigger
  // probably isn't envelope-level at all). Capture may show this folded into
  // the version write instead of a bare PATCH on the envelope.
  return birdJson<BirdJourney>(
    cfg.apiKey,
    `${journeysPath(cfg.workspaceId)}/${journeyId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trigger: {
          type: "journey-contact",
          data: {
            contextConditions: {},
            event: "contact-added-to-group",
            groupId: input.groupId,
          },
        },
      }),
    },
  );
}

// --- Step 3: TBD. Candidate body/verb below — REPLACE once capture lands. ---
export interface JourneySendStepInput {
  /** Approved WhatsApp template identity (Project + Version pattern). */
  templateProjectId: string;
  templateVersion: string;
  locale: string;
  /** Resolved via resolveBirdTemplateVariables() — see §2 below. */
  variables: Record<string, string>;
  /** WA channel to send from (e.g. the "THROWBACK" channel). */
  channelId: string;
}
export function buildAutorespJourneyDefinition(input: JourneySendStepInput) {
  // Mirrors the CONFIRMED live step-graph shape read from journey
  // "C26-Barcelona" (docs/D2C_BIRD_FLOW_AUTOMATION_INVESTIGATION.md Goal 3) —
  // this part of the shape is NOT a guess, it's a verified read.
  return {
    startAt: "createChannelMessage_1",
    steps: {
      createChannelMessage_1: {
        type: "mrn:v1:channels:endpoints:createChannelMessage:1.0.0",
        parameters: {
          payload: {
            receiver: { contacts: [{ id: "{{contact.id}}" }] },
            template: {
              locale: input.locale,
              name: "",
              projectId: input.templateProjectId,
              version: input.templateVersion,
              variables: input.variables,
            },
            capFrequency: true,
            ignoreGlobalHoldout: false,
            utm: { enabled: true },
          },
          request: { channelId: input.channelId, workspaceId: "{{run.workspaceId}}" },
        },
        next: "terminate_1",
      },
      terminate_1: { type: "terminate", parameters: { fail: false, code: "", reason: "" } },
    },
  };
}
export interface BirdJourneyVersion {
  id: string;
  status: string;
}
export async function createVersion(
  cfg: BirdJourneyClientConfig,
  journeyId: string,
  definition: ReturnType<typeof buildAutorespJourneyDefinition>,
): Promise<BirdJourneyVersion> {
  // TBD candidate — untested. GET on this collection is confirmed 200/empty;
  // POST support is NOT confirmed. Capture may show this folded into step 2
  // instead of being a separate call.
  return birdJson<BirdJourneyVersion>(
    cfg.apiKey,
    `${journeysPath(cfg.workspaceId)}/${journeyId}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ definition }),
    },
  );
}

// --- Step 4: TBD. Candidate verb below — REPLACE once capture lands. ---
export async function publishVersion(
  cfg: BirdJourneyClientConfig,
  journeyId: string,
  versionId: string,
): Promise<void> {
  // TBD candidate — by analogy with the CONFIRMED
  // PUT /channel-templates/{id}/activate pattern (templates/client.ts).
  const res = await birdFetch(
    cfg.apiKey,
    `${journeysPath(cfg.workspaceId)}/${journeyId}/versions/${versionId}/publish`,
    { method: "PUT" },
  );
  if (!res.ok) throw new BirdHttpError(res.status, await res.text());
}

// --- Cleanup / disarm. Verb TBD (delete vs deactivate vs archive). ---
export async function deactivateJourney(
  cfg: BirdJourneyClientConfig,
  journeyId: string,
): Promise<void> {
  // TBD — probe #1's cleanup path attempted PATCH {status:"inactive"} but
  // never actually exercised it (the create it depended on had already
  // failed). Confirmed-working fallback: DELETE (used successfully by both
  // probes for cleanup) — but DELETE on a *live* journey may be too
  // destructive for a real disarm; confirm whether "inactive" is a valid
  // PATCH-able status once the capture / a further probe covers it.
  const res = await birdFetch(
    cfg.apiKey,
    `${journeysPath(cfg.workspaceId)}/${journeyId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "inactive" }),
    },
  );
  if (!res.ok) throw new BirdHttpError(res.status, await res.text());
}

export interface CreateAutorespJourneyInput {
  workspaceId: string;
  apiKey: string;
  /** Deterministic name — same convention as the 92 live journeys, e.g. "T26-ALGARVE". */
  name: string;
  groupId: string;
  sendStep: JourneySendStepInput;
}
export interface CreateAutorespJourneyResult {
  journeyId: string;
  versionId: string;
  existed: boolean;
}

/**
 * Orchestrates steps 1-4. Idempotent by name (re-arming never mints a
 * duplicate journey — the exact anti-pattern this PR removes). On any
 * failure after the shell is created, rolls back by deactivating (not
 * deleting — avoid destroying a journey a human may already be editing)
 * the partial journey and rethrows, mirroring the rollback discipline in
 * .scratch/bird-journey-create-probe.mjs.
 */
export async function createOrUpdateAutorespJourney(
  input: CreateAutorespJourneyInput,
): Promise<CreateAutorespJourneyResult> {
  if (!JOURNEY_CREATE_VERIFIED) {
    throw new Error(
      "BIRD_JOURNEY_CREATE_UNVERIFIED: steps 2-4 are TBD pending DevTools capture. " +
        "See docs/D2C_BIRD_FLOW_AUTOMATION_INVESTIGATION.md.",
    );
  }
  const cfg: BirdJourneyClientConfig = { apiKey: input.apiKey, workspaceId: input.workspaceId };

  const existing = await findJourneyByName(cfg, input.name);
  if (existing?.publishedVersion) {
    return { journeyId: existing.id, versionId: existing.publishedVersion, existed: true };
  }

  const journey = existing ?? (await createJourneyShell(cfg, input.name));
  try {
    await attachTrigger(cfg, journey.id, { groupId: input.groupId });
    const definition = buildAutorespJourneyDefinition(input.sendStep);
    const version = await createVersion(cfg, journey.id, definition);
    await publishVersion(cfg, journey.id, version.id);
    return { journeyId: journey.id, versionId: version.id, existed: Boolean(existing) };
  } catch (e) {
    if (!existing) {
      await deactivateJourney(cfg, journey.id).catch(() => {});
    }
    throw e;
  }
}
```

---

## 2. Group resolver — CONFIRMED shape, one shared helper

**Discovery (2026-07-10, read-only probe):** Bird's `/workspaces/{ws}/groups`
and `/workspaces/{ws}/lists` are **the same underlying resource**, dual-mounted
on two path aliases — verified live: `GET /lists/{id}` and `GET /groups/{id}`
both return 200 for the same id (`T26-ALGARVE`'s group appears identically on
both). This matters because the **existing** WhatsApp poll cron
(`app/api/cron/d2c-autoresp-poll-bird/route.ts`) already resolves the signup
audience by looking up `/lists` by name match on `audience.tag`. A single
resolver now serves **both** the new Journey path and the existing poll cron —
no risk of them diverging onto different objects.

```typescript
/** lib/d2c/bird/groups/client.ts (or folded into journeys/client.ts) */

export interface BirdGroup {
  id: string;
  name: string;
  contactCount: number;
}

// CONFIRMED — POST /workspaces/{ws}/groups { name } -> 201 (probe #1, 2026-07-09).
// GET /workspaces/{ws}/groups?limit=100 -> 200, used for the idempotency check
// (also CONFIRMED, both probes used it safely).
export async function resolveOrCreateGroup(
  cfg: BirdJourneyClientConfig,
  name: string,
): Promise<{ group: BirdGroup; existed: boolean }> {
  const list = await birdJson<{ results: BirdGroup[] }>(
    cfg.apiKey,
    `/workspaces/${cfg.workspaceId}/groups?limit=100`,
    { method: "GET" },
  );
  const target = name.trim().toLowerCase();
  const existing = list.results?.find((g) => g.name.trim().toLowerCase() === target);
  if (existing) return { group: existing, existed: true };

  const created = await birdJson<BirdGroup>(
    cfg.apiKey,
    `/workspaces/${cfg.workspaceId}/groups`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  return { group: created, existed: false };
}
```

Naming convention: reuse whatever tag/group name the event's `autoresp_setup`
send already carries on `audience.tag` (same value the poll cron already
resolves against `/lists`) — do not invent a second naming scheme.

---

## 3. Journey definition builder — variable + template wiring

Already covered inline in §1's `buildAutorespJourneyDefinition` /
`JourneySendStepInput`. The variable resolution reuses the **existing**,
already-shipped resolver — no new variable logic:

```typescript
import { resolveBirdTemplateVariables } from "@/lib/d2c/bird/template-variables";
import { resolveBirdTemplateInfo } from "@/lib/d2c/bird/provider";

// In the arm action (see §4): resolve the event's approved template identity
// the SAME way the per-fire provider already does (audience.project_id /
// template_id, or variables.bird_template_project_id / _version_id — Bug B
// fix, 2026-07-08) — do not re-derive a new resolution rule.
const templateInfo = resolveBirdTemplateInfo(audience, variables);
const sendStep: JourneySendStepInput = {
  templateProjectId: templateInfo.projectId,
  templateVersion: templateInfo.versionId,
  locale: templateInfo.locale,
  variables: resolveBirdTemplateVariables({ event, copy, timezone }),
  channelId, // from the connection's channel_id credential
};
```

---

## 4. Arm/enrollment wiring — `lib/actions/d2c-sends.ts`

Extends `armAutoresponder` for the WhatsApp channel only (email stays exactly
as PR #704 left it — Customer Journey checklist, no code change here).

```typescript
// Inside armAutoresponder(), after the existing result_jsonb merge, ADD a
// WhatsApp-only branch gated by the feature flag (see §5):
if (
  send.channel === "whatsapp" &&
  process.env.FEATURE_D2C_BIRD_JOURNEY === "1" &&
  JOURNEY_CREATE_VERIFIED // both gates must be true — flag alone isn't enough
) {
  const connection = await getD2CConnectionById(admin, send.connection_id);
  const creds = await getD2CConnectionCredentials(admin, send.connection_id);
  if (shouldD2CDryRun({ ...connection, credentials: creds })) {
    // 3-of-3 gate: dry-run short-circuits BEFORE any live Bird write, same
    // discipline as every other D2C provider call.
    resultJsonb.bird_journey = { dryRun: true, plannedAt: new Date().toISOString() };
  } else {
    const { group } = await resolveOrCreateGroup(cfg, audienceTag);
    const result = await createOrUpdateAutorespJourney({
      workspaceId, apiKey, name: audienceTag, groupId: group.id, sendStep,
    });
    resultJsonb.bird_journey = {
      journeyId: result.journeyId,
      versionId: result.versionId,
      groupId: group.id,
      publishedAt: new Date().toISOString(),
    };
  }
}
```

**Disarm:** WhatsApp branch calls `deactivateJourney` (verb TBD, §1) instead of
leaving the Journey running unattended — this is a real behavioural
improvement over the Mailchimp precedent (PR #704 explicitly could NOT pause a
Customer Journey; Bird's `PATCH {status:"inactive"}` candidate, if confirmed,
means Bird disarm can be a real no-more-sends action, not just a dashboard
label).

---

## 5. Feature flag + 3-of-3 gate

- **New flag `FEATURE_D2C_BIRD_JOURNEY`** (naming consistent with the existing
  `FEATURE_D2C_LIVE`). Default unset/`0` — `armAutoresponder` keeps using the
  current per-fire path (`d2c-autoresp-poll-bird` cron) unchanged. Flip per
  rollout confidence, not globally on day one — Throwback first (highest
  volume, most scrutiny), other brands after a burn-in period.
- **3-of-3 gate unchanged**: `FEATURE_D2C_LIVE` (env) AND
  `connection.live_enabled` AND `connection.approved_by_matas` still gate every
  *live* Bird write, exactly as today (`shouldD2CDryRun` / `d2cDryRunGates` in
  `lib/d2c/types.ts`). The new `FEATURE_D2C_BIRD_JOURNEY` flag is an
  **additional**, narrower gate on top — it controls whether the Journey path
  is attempted at all, not a replacement for the existing gate.
- **`JOURNEY_CREATE_VERIFIED` code-level gate** (§1): even with both flags on,
  `createOrUpdateAutorespJourney` refuses to run until this is flipped `true`
  post-capture. Belt-and-braces against shipping on unconfirmed candidates.

---

## 6. Subtractive dedup — stop the per-fire path once the Journey owns the send

Mirrors PR #704's Mailchimp shape exactly (same double-send lesson): once a
WhatsApp `autoresp_setup` send has a **live, published** Bird Journey, the
per-fire poll cron must stop firing for that event — otherwise every new
signup gets the template twice (once from the Journey's native
`contact-added-to-group` trigger, once from our own poll-and-fire).

```typescript
// app/api/cron/d2c-autoresp-poll-bird/route.ts — add ONE check per send,
// right after the existing isAutorespArmed() gate:
for (const send of sends) {
  if (!isAutorespArmed(send.result_jsonb)) {
    results.push({ sendId: send.id, outcome: "not_armed" });
    continue;
  }
  // NEW: once a Journey is live for this send, it owns delivery — stop
  // polling/firing here, same subtractive shape as PR #704 (Mailchimp).
  const journey = readBirdJourneyResult(send.result_jsonb); // new helper, helpers.ts
  if (journey?.publishedAt && !journey.dryRun) {
    results.push({ sendId: send.id, outcome: "skipped_journey_owns_send" });
    continue;
  }
  // ...existing poll + fireAutorespToMember loop, unchanged...
}
```

This is the one piece of this outline that touches a **shipped, live** file —
flag it explicitly in the PR body (per the thread-boundaries convention) since
it changes behaviour on the currently-working PR #700 path, not just adds new
code.

---

## Rollout shape (summary)

1. Ship `journeys/client.ts` + group resolver + definition builder fully
   `JOURNEY_CREATE_VERIFIED = false` (dead code path, zero live-behaviour
   change) — safe to merge/review independently of the capture landing.
2. Once the capture confirms steps 2-4, replace the TBD bodies, flip
   `JOURNEY_CREATE_VERIFIED = true`, add tests against the confirmed shapes.
3. Wire `armAutoresponder` + the poll-cron subtractive check behind
   `FEATURE_D2C_BIRD_JOURNEY` (default off).
4. Matas approves + flips the flag for Throwback; verify one real event
   end-to-end (arm → Journey visible + Active in Bird UI → signup → single
   WhatsApp send received → poll cron logs `skipped_journey_owns_send` for
   that event) before widening.

**PR title (provisional):** `feat(d2c/bird): autoresp via Journey creation, not manual per-event clone`
**Branch (provisional):** `cursor/d2c-bird-journey-automation`
**Self-merge:** No — behaviour change on a live revenue-path send, needs Matas review (same bar as PR #704).

---

## Rollout preferences (Matas, 2026-07-10) — binding for whoever scaffolds this

1. **Ship §1 (`journeys/client.ts`) + §2 (group resolver) + §3 (definition
   builder) incrementally as small PRs**, each with `JOURNEY_CREATE_VERIFIED
   = false` throwing — dead code, zero live-behaviour change, reviewable
   independently of the capture landing. Time-compression: don't block this
   on the capture.
2. **Do NOT merge §6 (poll-cron subtractive dedup)** until the full
   create/attach-trigger/publish sequence is CONFIRMED end-to-end and
   `JOURNEY_CREATE_VERIFIED` is flipped `true`. That file touches the
   shipped, live WhatsApp fire path (PR #700) — it cannot ship on
   provisional assumptions, unlike §1-§3 which are inert until wired in.
3. **Update memory `reference_bird_journey_create_via_api.md` only once the
   sequence is CONFIRMED** (i.e. once the DevTools capture replaces every TBD
   above) — not written yet; this outline is still provisional.

**Status as of 2026-07-10:** confirmations requested by Matas were answered
read-only (no probe #3 was run by this agent; a real leftover
`zz-capture-test-2026-07-09` journey from Matas's own capture session was
found live, inspected read-only, and deleted + verified back to baseline —
see the investigation doc). Steps 2-4 remain TBD. Scaffolding per preference
#1 has **not** started yet — pending explicit greenlight.
