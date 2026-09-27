/**
 * Live ad-set targeting update.
 *
 * POST /{adset_id} replaces the whole targeting object. This module reads
 * targeting as an opaque record, changes only custom_audiences or
 * excluded_custom_audiences, and hands the rest back unchanged.
 *
 * The Graph call lives in the route. This file does not import
 * lib/meta/client.ts, and it does not run from the launch route.
 */

import {
  ADSET_TARGETING_WRITES_DISABLED_MESSAGE,
  LEARNING_PHASE_WARNING,
  type AudienceListAction,
  type AudienceListDirection,
} from "./adset-targeting-copy.ts";
import type { MetaWriteContext } from "./write-idempotency.ts";
import {
  invalidateMetaWritePayload,
  MetaWriteLedgerRequiredError,
  withMetaWriteIdempotency,
} from "./write-idempotency.ts";

export {
  ADSET_TARGETING_WRITES_DISABLED_MESSAGE,
  LEARNING_PHASE_WARNING,
  type AudienceListAction,
  type AudienceListDirection,
};

export type AudienceListKey = "custom_audiences" | "excluded_custom_audiences";

export function adsetTargetingWritesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED === "true";
}

export function audienceListKey(direction: AudienceListDirection): AudienceListKey {
  return direction === "include" ? "custom_audiences" : "excluded_custom_audiences";
}

/** Ledger payload. Remove uses its own direction so it is not the add triple. */
export function adsetTargetingLedgerTriple(input: {
  adSetId: string;
  audienceId: string;
  direction: AudienceListDirection;
  action: AudienceListAction;
}): { adset_id: string; audience_id: string; direction: string } {
  const direction =
    input.action === "add"
      ? input.direction
      : input.direction === "include"
        ? "remove_include"
        : "remove_exclude";
  return {
    adset_id: input.adSetId,
    audience_id: input.audienceId,
    direction,
  };
}

export function formatAdSetAudienceDiff(input: {
  adSetName: string;
  audienceName: string;
  direction: AudienceListDirection;
  action: AudienceListAction;
  beforeCount: number;
  afterCount: number;
}): string {
  const sign = input.action === "add" ? "+" : "−";
  return `${input.adSetName}: ${sign}${input.audienceName} (${input.direction}) · ${input.beforeCount} → ${input.afterCount} audiences`;
}

export type MergeAudienceResult =
  | {
      ok: true;
      targeting: Record<string, unknown>;
      beforeCount: number;
      afterCount: number;
      listKey: AudienceListKey;
    }
  | { ok: false; reason: "already_present" | "not_present" };

function entryId(entry: unknown): string | null {
  if (typeof entry === "string" || typeof entry === "number") return String(entry);
  if (!entry || typeof entry !== "object") return null;
  const id = (entry as { id?: unknown }).id;
  if (typeof id === "string" || typeof id === "number") return String(id);
  return null;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Clone `targeting` and edit one audience list. Every other key is the
 * value Meta returned. The input object is not mutated.
 */
export function mergeAudienceIntoTargeting(
  targeting: Record<string, unknown>,
  audience: { id: string; name: string },
  direction: AudienceListDirection,
  action: AudienceListAction,
): MergeAudienceResult {
  const listKey = audienceListKey(direction);
  const next = structuredClone(targeting);
  const current = asList(next[listKey]);
  const present = current.some((entry) => entryId(entry) === audience.id);
  if (action === "add" && present) return { ok: false, reason: "already_present" };
  if (action === "remove" && !present) return { ok: false, reason: "not_present" };
  next[listKey] =
    action === "add"
      ? [...current, { id: audience.id, name: audience.name }]
      : current.filter((entry) => entryId(entry) !== audience.id);
  return {
    ok: true,
    targeting: next,
    beforeCount: current.length,
    afterCount: asList(next[listKey]).length,
    listKey,
  };
}

export interface AdSetTargetingSnapshot {
  id: string;
  name: string;
  effectiveStatus: string;
  campaignId: string;
  targeting: Record<string, unknown>;
}

export interface AdSetTargetingGraph {
  read(adSetId: string): Promise<AdSetTargetingSnapshot | null>;
  write(adSetId: string, targeting: Record<string, unknown>): Promise<void>;
}

export interface AdSetAudienceOutcome {
  adSetId: string;
  adSetName: string | null;
  outcome: "ready" | "written" | "noop" | "refused" | "failed";
  reason: string | null;
  diff: string | null;
  beforeCount: number | null;
  afterCount: number | null;
}

export interface AdSetAudienceRequest {
  adSetIds: string[];
  audience: { id: string; name: string };
  direction: AudienceListDirection;
  action: AudienceListAction;
  /** Live Meta campaign id on the published draft. A mismatched read is refused. */
  campaignId: string;
  graph: AdSetTargetingGraph;
}

const META_OBJECT_ID = /^[0-9]{5,32}$/;

function logOutcome(outcome: AdSetAudienceOutcome): void {
  console.log(
    `[adset-targeting] adset=${outcome.adSetId} name=${outcome.adSetName ?? ""} outcome=${outcome.outcome} reason=${outcome.reason ?? ""}`,
  );
}

function refused(
  adSetId: string,
  adSetName: string | null,
  reason: string,
): AdSetAudienceOutcome {
  return {
    adSetId,
    adSetName,
    outcome: "refused",
    reason,
    diff: null,
    beforeCount: null,
    afterCount: null,
  };
}

function deadReason(status: string): string | null {
  const normalized = status.trim().toUpperCase();
  if (normalized === "ARCHIVED") return "Ad set is ARCHIVED";
  if (normalized === "DELETED") return "Ad set is DELETED";
  return null;
}

async function readForChange(
  request: AdSetAudienceRequest,
  adSetId: string,
): Promise<
  | { ok: false; outcome: AdSetAudienceOutcome }
  | {
      ok: true;
      snapshot: AdSetTargetingSnapshot;
      merged: Extract<MergeAudienceResult, { ok: true }>;
    }
> {
  if (!META_OBJECT_ID.test(adSetId)) {
    return { ok: false, outcome: refused(adSetId, null, "Ad set id is not a Meta id") };
  }
  let snapshot: AdSetTargetingSnapshot | null;
  try {
    snapshot = await request.graph.read(adSetId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Read failed";
    return {
      ok: false,
      outcome: refused(adSetId, null, `Could not read this ad set (${message})`),
    };
  }
  if (!snapshot) {
    return {
      ok: false,
      outcome: refused(adSetId, null, "Could not read this ad set"),
    };
  }
  if (!snapshot.effectiveStatus.trim() || !snapshot.campaignId.trim()) {
    return {
      ok: false,
      outcome: refused(
        adSetId,
        snapshot.name || null,
        "The read did not include status and campaign, so it was not changed",
      ),
    };
  }
  if (snapshot.campaignId !== request.campaignId) {
    return {
      ok: false,
      outcome: refused(
        adSetId,
        snapshot.name || null,
        "This ad set is not on the published campaign",
      ),
    };
  }
  if (!snapshot.targeting || typeof snapshot.targeting !== "object" || Array.isArray(snapshot.targeting)) {
    return {
      ok: false,
      outcome: refused(adSetId, snapshot.name || null, "The read did not include targeting"),
    };
  }
  const dead = deadReason(snapshot.effectiveStatus);
  if (dead) return { ok: false, outcome: refused(adSetId, snapshot.name || null, dead) };

  const merged = mergeAudienceIntoTargeting(
    snapshot.targeting,
    request.audience,
    request.direction,
    request.action,
  );
  if (!merged.ok) {
    const reason =
      merged.reason === "already_present"
        ? `Already ${request.direction === "include" ? "included" : "excluded"}`
        : `Not in the ${request.direction} list`;
    return { ok: false, outcome: refused(adSetId, snapshot.name || null, reason) };
  }
  return { ok: true, snapshot, merged };
}

export async function planAdSetAudienceChanges(
  request: AdSetAudienceRequest,
): Promise<AdSetAudienceOutcome[]> {
  const outcomes: AdSetAudienceOutcome[] = [];
  for (const adSetId of request.adSetIds) {
    const read = await readForChange(request, adSetId);
    if (!read.ok) {
      logOutcome(read.outcome);
      outcomes.push(read.outcome);
      continue;
    }
    const outcome: AdSetAudienceOutcome = {
      adSetId,
      adSetName: read.snapshot.name || null,
      outcome: "ready",
      reason: null,
      diff: formatAdSetAudienceDiff({
        adSetName: read.snapshot.name || adSetId,
        audienceName: request.audience.name,
        direction: request.direction,
        action: request.action,
        beforeCount: read.merged.beforeCount,
        afterCount: read.merged.afterCount,
      }),
      beforeCount: read.merged.beforeCount,
      afterCount: read.merged.afterCount,
    };
    logOutcome(outcome);
    outcomes.push(outcome);
  }
  return outcomes;
}

export async function applyAdSetAudienceChanges(
  request: AdSetAudienceRequest & {
    writesEnabled: boolean;
    ledger: MetaWriteContext;
  },
): Promise<AdSetAudienceOutcome[]> {
  if (!request.writesEnabled) {
    return request.adSetIds.map((adSetId) => {
      const outcome = refused(adSetId, null, ADSET_TARGETING_WRITES_DISABLED_MESSAGE);
      logOutcome(outcome);
      return outcome;
    });
  }

  const outcomes: AdSetAudienceOutcome[] = [];
  for (const adSetId of request.adSetIds) {
    let adSetName: string | null = null;
    try {
      const read = await readForChange(request, adSetId);
      if (!read.ok) {
        logOutcome(read.outcome);
        outcomes.push(read.outcome);
        continue;
      }
      adSetName = read.snapshot.name || null;
      const diff = formatAdSetAudienceDiff({
        adSetName: read.snapshot.name || adSetId,
        audienceName: request.audience.name,
        direction: request.direction,
        action: request.action,
        beforeCount: read.merged.beforeCount,
        afterCount: read.merged.afterCount,
      });
      const triple = adsetTargetingLedgerTriple({
        adSetId,
        audienceId: request.audience.id,
        direction: request.direction,
        action: request.action,
      });
      let wrote = false;
      await withMetaWriteIdempotency(
        request.ledger,
        "adset_targeting_update",
        triple,
        async () => {
          wrote = true;
          await request.graph.write(adSetId, read.merged.targeting);
          return adSetId;
        },
        { required: true },
      );
      if (wrote) {
        await invalidateMetaWritePayload(
          request.ledger,
          "adset_targeting_update",
          adsetTargetingLedgerTriple({
            adSetId,
            audienceId: request.audience.id,
            direction: request.direction,
            action: request.action === "add" ? "remove" : "add",
          }),
        );
      }
      const outcome: AdSetAudienceOutcome = {
        adSetId,
        adSetName,
        outcome: wrote ? "written" : "noop",
        reason: wrote ? null : "Already recorded on the write ledger",
        diff,
        beforeCount: read.merged.beforeCount,
        afterCount: read.merged.afterCount,
      };
      logOutcome(outcome);
      outcomes.push(outcome);
    } catch (err) {
      const reason =
        err instanceof MetaWriteLedgerRequiredError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Write failed";
      const outcome: AdSetAudienceOutcome = {
        adSetId,
        adSetName,
        outcome: "failed",
        reason,
        diff: null,
        beforeCount: null,
        afterCount: null,
      };
      logOutcome(outcome);
      outcomes.push(outcome);
    }
  }
  return outcomes;
}
