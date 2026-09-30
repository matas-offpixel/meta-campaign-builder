/**
 * Live ad-set destination update.
 *
 * `POST /{adset_id}` with `{ destination_type: "WEBSITE" }` and nothing else.
 * Unlike a targeting push there is no object to merge: the field is a scalar,
 * so the read exists to decide whether the write is allowed and whether it
 * would change anything, not to preserve neighbouring keys.
 *
 * This is the backfill for every ad set launched before the website
 * destination became the default. An ad set created without the field reads
 * back as Meta's literal `"UNDEFINED"`, and the Ads Manager Edit view then
 * shows a destination the launcher never chose — an operator saving that view
 * moves where the ads point.
 *
 * Verified live 2026-09-30 before this module was written, because a write
 * Meta refuses is not worth shipping behind a gate:
 *
 *   paused ad set, UNDEFINED -> WEBSITE      {"success": true}, reads back WEBSITE
 *   running ad set, same value written       {"success": true}
 *   running ad set, UNDEFINED -> WEBSITE     {"success": true}, reads back WEBSITE
 *     (ad set 120249993287300453, ACTIVE, GBP 0.23 / 40 impressions)
 *
 * The last case also left `learning_stage_info.last_sig_edit_ts` unchanged, so
 * Meta did not count it as a significant edit and delivery did not re-enter
 * the learning phase. That is why this module carries no learning-phase
 * warning, where the targeting push does.
 *
 * Shares the gate (`OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED`), the
 * refusal rules, and the write ledger with `adset-targeting-write.ts`. The
 * Graph call lives in the route. This file does not import lib/meta/client.ts,
 * and it does not run from the launch route.
 */

import { META_DESTINATION_TYPE_UNSET } from "./adset.ts";
import { ADSET_DESTINATION_WRITES_DISABLED_MESSAGE } from "./adset-destination-copy.ts";
import {
  adsetTargetingWritesEnabled,
  deadReason,
  META_OBJECT_ID,
} from "./adset-targeting-write.ts";
import type { MetaWriteContext } from "./write-idempotency.ts";
import {
  MetaWriteLedgerRequiredError,
  withMetaWriteIdempotency,
} from "./write-idempotency.ts";

/** The only value this module ever writes. */
export const AD_SET_WEBSITE_DESTINATION = "WEBSITE";

export { ADSET_DESTINATION_WRITES_DISABLED_MESSAGE } from "./adset-destination-copy.ts";

/** Same gate as the targeting push — one switch for live ad-set writes. */
export { adsetTargetingWritesEnabled as adsetDestinationWritesEnabled };

export interface AdSetDestinationSnapshot {
  id: string;
  name: string;
  effectiveStatus: string;
  campaignId: string;
  /** Verbatim Graph value, including Meta's `"UNDEFINED"`. */
  destinationType: string;
}

export interface AdSetDestinationGraph {
  read(adSetId: string): Promise<AdSetDestinationSnapshot | null>;
  write(adSetId: string, destinationType: string): Promise<void>;
}

export interface AdSetDestinationOutcome {
  adSetId: string;
  adSetName: string | null;
  outcome: "ready" | "written" | "noop" | "refused" | "failed";
  reason: string | null;
  /** Operator-facing before → after, or null when nothing would change. */
  diff: string | null;
  before: string | null;
  after: string | null;
}

export interface AdSetDestinationRequest {
  adSetIds: string[];
  /** Live Meta campaign id on the published draft. A mismatched read is refused. */
  campaignId: string;
  graph: AdSetDestinationGraph;
}

/** Ledger payload. One row per ad set — the value written is never anything else. */
export function adsetDestinationLedgerTriple(adSetId: string): {
  adset_id: string;
  destination_type: string;
} {
  return { adset_id: adSetId, destination_type: AD_SET_WEBSITE_DESTINATION };
}

export function formatAdSetDestinationDiff(input: {
  adSetName: string;
  before: string;
}): string {
  return `${input.adSetName}: ${input.before} → ${AD_SET_WEBSITE_DESTINATION}`;
}

/** True when the ad set already carries a website destination. */
export function alreadyWebsiteDestination(destinationType: string): boolean {
  return destinationType.trim().toUpperCase() === AD_SET_WEBSITE_DESTINATION;
}

function logOutcome(outcome: AdSetDestinationOutcome): void {
  console.log(
    `[adset-destination] adset=${outcome.adSetId} name=${outcome.adSetName ?? ""} ` +
      `outcome=${outcome.outcome} before=${outcome.before ?? ""} reason=${outcome.reason ?? ""}`,
  );
}

function refused(
  adSetId: string,
  adSetName: string | null,
  reason: string,
): AdSetDestinationOutcome {
  return {
    adSetId,
    adSetName,
    outcome: "refused",
    reason,
    diff: null,
    before: null,
    after: null,
  };
}

type ReadForChange =
  | { ok: false; outcome: AdSetDestinationOutcome }
  | { ok: true; snapshot: AdSetDestinationSnapshot };

/**
 * Every refusal the targeting push applies, on the same read: not a Meta id,
 * a read that failed or came back without status/campaign, an ad set on
 * another campaign, and an archived or deleted ad set.
 */
async function readForChange(
  request: AdSetDestinationRequest,
  adSetId: string,
): Promise<ReadForChange> {
  if (!META_OBJECT_ID.test(adSetId)) {
    return { ok: false, outcome: refused(adSetId, null, "Ad set id is not a Meta id") };
  }
  let snapshot: AdSetDestinationSnapshot | null;
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
    return { ok: false, outcome: refused(adSetId, null, "Could not read this ad set") };
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
  const dead = deadReason(snapshot.effectiveStatus);
  if (dead) return { ok: false, outcome: refused(adSetId, snapshot.name || null, dead) };
  return { ok: true, snapshot };
}

function readyOutcome(snapshot: AdSetDestinationSnapshot): AdSetDestinationOutcome {
  const before = snapshot.destinationType || META_DESTINATION_TYPE_UNSET;
  if (alreadyWebsiteDestination(before)) {
    return {
      adSetId: snapshot.id,
      adSetName: snapshot.name || null,
      outcome: "noop",
      reason: "Already set to Website",
      diff: null,
      before,
      after: before,
    };
  }
  return {
    adSetId: snapshot.id,
    adSetName: snapshot.name || null,
    outcome: "ready",
    reason: null,
    diff: formatAdSetDestinationDiff({ adSetName: snapshot.name || snapshot.id, before }),
    before,
    after: AD_SET_WEBSITE_DESTINATION,
  };
}

/** Dry run. Reads each ad set and reports what the write would change. */
export async function planAdSetDestinationChanges(
  request: AdSetDestinationRequest,
): Promise<AdSetDestinationOutcome[]> {
  const outcomes: AdSetDestinationOutcome[] = [];
  for (const adSetId of request.adSetIds) {
    const read = await readForChange(request, adSetId);
    const outcome = read.ok ? readyOutcome(read.snapshot) : read.outcome;
    logOutcome(outcome);
    outcomes.push(outcome);
  }
  return outcomes;
}

export async function applyAdSetDestinationChanges(
  request: AdSetDestinationRequest & {
    writesEnabled: boolean;
    ledger: MetaWriteContext;
  },
): Promise<AdSetDestinationOutcome[]> {
  if (!request.writesEnabled) {
    return request.adSetIds.map((adSetId) => {
      const outcome = refused(adSetId, null, ADSET_DESTINATION_WRITES_DISABLED_MESSAGE);
      logOutcome(outcome);
      return outcome;
    });
  }

  const outcomes: AdSetDestinationOutcome[] = [];
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
      const planned = readyOutcome(read.snapshot);
      if (planned.outcome === "noop") {
        logOutcome(planned);
        outcomes.push(planned);
        continue;
      }

      let wrote = false;
      await withMetaWriteIdempotency(
        request.ledger,
        "adset_destination_update",
        adsetDestinationLedgerTriple(adSetId),
        async () => {
          wrote = true;
          await request.graph.write(adSetId, AD_SET_WEBSITE_DESTINATION);
          return adSetId;
        },
        { required: true },
      );

      const outcome: AdSetDestinationOutcome = {
        ...planned,
        outcome: wrote ? "written" : "noop",
        reason: wrote ? null : "Already recorded on the write ledger",
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
      const outcome: AdSetDestinationOutcome = {
        adSetId,
        adSetName,
        outcome: "failed",
        reason,
        diff: null,
        before: null,
        after: null,
      };
      logOutcome(outcome);
      outcomes.push(outcome);
    }
  }
  return outcomes;
}
