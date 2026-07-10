/**
 * lib/d2c/bird/journeys/client.ts
 *
 * Typed client for Bird's Journey automation API — creates a per-event
 * "contact added to group -> send WhatsApp template" autoresponder,
 * replacing the manual per-event UI clone (92 live journeys today, many
 * literally named "(copy)"). See docs/D2C_BIRD_FLOW_AUTOMATION_INVESTIGATION.md
 * and docs/D2C_BIRD_JOURNEY_PR_OUTLINE_PROVISIONAL.md for the full writeup.
 *
 * Sequence status (2026-07-10):
 *   1. CONFIRMED  POST /workspaces/{ws}/journeys { name } -> 201 inert shell
 *      (status:"requires-configuration", trigger:null, versionCount:0).
 *      Byte-exact against .scratch/bird-journey-create-probe-capture.txt
 *      (probe #2, 2026-07-10T07:22:54.919Z).
 *   2. TBD  version write (trigger + definition together, per a read-only
 *      finding that `trigger` lives on the *version* object, not the journey
 *      envelope — collapses what was originally modelled as two separate
 *      calls into one). Verb (POST vs PATCH) and body shape are candidates
 *      only; `writeJourneyVersion` throws until confirmed.
 *   3. TBD  publish. Candidate verb by analogy with the CONFIRMED
 *      `PUT .../channel-templates/{id}/activate` pattern in
 *      lib/d2c/bird/templates/client.ts; `publishVersion` throws until
 *      confirmed.
 *
 * DO NOT call writeJourneyVersion / publishVersion from any live code path —
 * they throw BIRD_JOURNEY_SEQUENCE_UNCONFIRMED while JOURNEY_CREATE_VERIFIED
 * is false. Flip it only once a DevTools capture (or an equivalent controlled
 * probe) confirms the exact request shapes.
 */

import { BirdHttpError, birdFetch, birdJson } from "../client.ts";

/** Flip true only once the version-write + publish sequence is byte-confirmed. */
export const JOURNEY_CREATE_VERIFIED = false;

export interface BirdJourneyClientConfig {
  apiKey: string;
  workspaceId: string;
}

export interface BirdJourneyTrigger {
  type: string;
  data: Record<string, unknown>;
}

export interface BirdJourney {
  id: string;
  name: string;
  status: string; // "requires-configuration" | "active" | "inactive" | ...
  trigger: BirdJourneyTrigger | null;
  draftVersion: string | null;
  publishedVersion: string | null;
  versionCount: number;
}

export interface BirdJourneyVersion {
  id: string;
  journeyId?: string;
  status: string; // "draft" | "published" | ...
  isValid?: boolean;
  isTriggerValid?: boolean;
  stepCount?: number;
  editToken?: string;
}

function journeysPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/journeys`;
}

function versionsPath(workspaceId: string, journeyId: string): string {
  return `${journeysPath(workspaceId)}/${journeyId}/versions`;
}

/** Bird list responses vary in envelope key; normalise to an array. */
function unwrapList<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    const r = (json as Record<string, unknown>).results;
    if (Array.isArray(r)) return r as T[];
  }
  return [];
}

function assertSequenceVerified(op: string): void {
  if (!JOURNEY_CREATE_VERIFIED) {
    throw new Error(
      `BIRD_JOURNEY_SEQUENCE_UNCONFIRMED: ${op} — sequence not yet byte-confirmed. ` +
        "See docs/D2C_BIRD_FLOW_AUTOMATION_INVESTIGATION.md and " +
        "docs/D2C_BIRD_JOURNEY_PR_OUTLINE_PROVISIONAL.md. Do not call this from " +
        "a live code path until JOURNEY_CREATE_VERIFIED is flipped true.",
    );
  }
}

// ─── Reads (CONFIRMED — GET was used safely by both controlled probes) ────

export async function listJourneys(
  cfg: BirdJourneyClientConfig,
  limit = 100,
): Promise<BirdJourney[]> {
  const capped = Math.min(limit, 100);
  const json = await birdJson<unknown>(
    cfg.apiKey,
    `${journeysPath(cfg.workspaceId)}?limit=${capped}`,
    { method: "GET" },
  );
  return unwrapList<BirdJourney>(json);
}

export async function getJourney(
  cfg: BirdJourneyClientConfig,
  journeyId: string,
): Promise<BirdJourney> {
  return birdJson<BirdJourney>(
    cfg.apiKey,
    `${journeysPath(cfg.workspaceId)}/${journeyId}`,
    { method: "GET" },
  );
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

export async function listJourneyVersions(
  cfg: BirdJourneyClientConfig,
  journeyId: string,
): Promise<BirdJourneyVersion[]> {
  const json = await birdJson<unknown>(
    cfg.apiKey,
    versionsPath(cfg.workspaceId, journeyId),
    { method: "GET" },
  );
  return unwrapList<BirdJourneyVersion>(json);
}

// ─── Step 1: CONFIRMED ──────────────────────────────────────────────────────

/**
 * Create an inert journey shell. Verified body: `{ name }` only — no
 * trigger, version, or steps. Response: `status: "requires-configuration"`,
 * `trigger: null`, `versionCount: 0`. NOT idempotent by itself — callers
 * needing idempotency should check `findJourneyByName` first (same pattern
 * as `findCampaignByName` in lib/d2c/bird/campaigns/client.ts).
 */
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

/**
 * Delete a journey. CONFIRMED — used successfully as the cleanup step by
 * every controlled probe (204, no body). Destructive: prefer this only for
 * test/probe cleanup, not as a production "disarm" action once a journey may
 * be live (disarm semantics are still TBD — see the outline doc §1).
 */
export async function deleteJourney(
  cfg: BirdJourneyClientConfig,
  journeyId: string,
): Promise<void> {
  const res = await birdFetch(
    cfg.apiKey,
    `${journeysPath(cfg.workspaceId)}/${journeyId}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new BirdHttpError(res.status, await res.text());
}

// ─── Steps 2+3: TBD — gated, unreachable until JOURNEY_CREATE_VERIFIED ────

export interface WriteJourneyVersionInput {
  trigger: BirdJourneyTrigger;
  definition: Record<string, unknown>;
  /** Overwrite an existing draft version, if known. Omit to create a new one. */
  versionId?: string;
}

/**
 * TBD candidate — writes `{ trigger, definition }` onto a journey version in
 * one call. Untested: verb (`POST` to create vs `PATCH` an existing draft),
 * and whether the version's `editToken` must be echoed back for optimistic
 * concurrency, are both unconfirmed. Throws BIRD_JOURNEY_SEQUENCE_UNCONFIRMED
 * before ever reaching the network — this body is dead code until the flag
 * flips.
 */
export async function writeJourneyVersion(
  cfg: BirdJourneyClientConfig,
  journeyId: string,
  input: WriteJourneyVersionInput,
): Promise<BirdJourneyVersion> {
  assertSequenceVerified("writeJourneyVersion");
  const method = input.versionId ? "PATCH" : "POST";
  const path = input.versionId
    ? `${versionsPath(cfg.workspaceId, journeyId)}/${input.versionId}`
    : versionsPath(cfg.workspaceId, journeyId);
  return birdJson<BirdJourneyVersion>(cfg.apiKey, path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trigger: input.trigger, definition: input.definition }),
  });
}

/**
 * TBD candidate — by analogy with the CONFIRMED
 * `PUT .../channel-templates/{id}/activate` verb-suffix pattern in
 * lib/d2c/bird/templates/client.ts. Throws BIRD_JOURNEY_SEQUENCE_UNCONFIRMED
 * before ever reaching the network.
 */
export async function publishVersion(
  cfg: BirdJourneyClientConfig,
  journeyId: string,
  versionId: string,
): Promise<void> {
  assertSequenceVerified("publishVersion");
  const res = await birdFetch(
    cfg.apiKey,
    `${versionsPath(cfg.workspaceId, journeyId)}/${versionId}/publish`,
    { method: "PUT" },
  );
  if (!res.ok) throw new BirdHttpError(res.status, await res.text());
}
