import {
  describeEventSourcePermissionFailure,
  isEventSourcePermissionError,
  parseOffendingEventSourceIds,
  splitSeedsByOffendingIds,
  // Explicit extension: this module is imported by the node:test runner under
  // --experimental-strip-types, which does not resolve extensionless specifiers.
} from "./event-source-permission.ts";

/**
 * lib/audiences/event-source-recovery.ts
 *
 * The recovery ladder for Meta's event-source permission refusal (code 2654 /
 * subcode 1713140), kept free of Graph, Supabase and `server-only` so the
 * decision logic can be tested exhaustively offline. The live wiring lives in
 * `lib/meta/audience-write.ts`, which supplies the two callbacks.
 *
 * ── Why a ladder ────────────────────────────────────────────────────────────
 * Meta builds a multi-source audience atomically: ONE unauthorised seed kills the
 * whole create. On 2026-07-27 that took two Electric Brixton audiences down and
 * lost 3 usable seed pages along with the single page that was not authorised.
 * Meta names the offending source in the message, so none of that was necessary.
 *
 * Cheapest correct action first:
 *   1. FIX — grant the operator ADVERTISE on the named seeds and retry the
 *      identical payload. Verified live to clear the refusal (see
 *      `__tests__/fixtures/event_source_permission_remediation.json`). Preferred
 *      because the operator still gets the audience they asked for.
 *   2. SALVAGE — if the grant is impossible (seed not in a connected Business
 *      Manager, BM token expired, Meta refuses), drop ONLY the named seeds and
 *      build from the rest, recording what was lost and how to get it back.
 *   3. EXPLAIN — if nothing usable remains, fail with the real cause and the real
 *      fix instead of "Permissions error".
 *
 * Each stage is attempted at most once. A refusal that survives both a grant and
 * a seed drop is a genuine dead end, and re-looping would only burn Meta quota.
 */

export interface SeedRemediationResult {
  remediated: string[];
  skipped: { sourceId: string; reason: string }[];
}

export interface EventSourceRecoveryOptions<T> {
  /** Seed ids the audience asked for, in order. Empty for non-seed audiences. */
  requested: string[];
  /**
   * Perform the create. `seeds === null` means "exactly as originally requested";
   * an array means "build from this subset". Rejects with Meta's error.
   */
  create: (seeds: string[] | null) => Promise<T>;
  /** Grant access to the named seeds. Must never throw (see SeedRemediator). */
  remediate: (sourceIds: string[]) => Promise<SeedRemediationResult>;
  /** Optional id → display name, for operator-facing messages. */
  names?: Record<string, string>;
  /** Called with a human note when a stage is skipped; defaults to console.warn. */
  onWarn?: (message: string) => void;
}

export interface EventSourceRecoveryResult<T> {
  result: T;
  /** Non-fatal explanation of what recovery had to do; null on a clean create. */
  note: string | null;
}

/**
 * Create, and climb the ladder if Meta refuses on event-source permissions.
 *
 * Any error that is NOT a 1713140 refusal is rethrown untouched — this must not
 * become a catch-all that turns unrelated failures into confusing seed advice.
 */
export async function createWithEventSourceRecovery<T>(
  options: EventSourceRecoveryOptions<T>,
): Promise<EventSourceRecoveryResult<T>> {
  const warn = options.onWarn ?? ((m: string) => console.warn(`[audience-write] ${m}`));
  const names = options.names ?? {};

  try {
    return { result: await options.create(null), note: null };
  } catch (firstErr) {
    if (!isEventSourcePermissionError(firstErr)) throw firstErr;

    const offending = parseOffendingEventSourceIds(firstErr);

    // Meta refused but named nothing: there is no seed to grant and none to drop.
    // Guessing would mean discarding sources it never objected to, so this stays
    // a failure — but one that explains the actual cause.
    if (offending.length === 0 || options.requested.length === 0) {
      throw new Error(
        `${errorText(firstErr)} — ${describeEventSourcePermissionFailure(offending, names)}`,
      );
    }

    // ── 1. fix the cause ─────────────────────────────────────────────────────
    const outcome = await options.remediate(offending);
    if (outcome.remediated.length > 0) {
      try {
        const result = await options.create(null);
        return {
          result,
          note:
            `Granted you ADVERTISE on ${labelList(outcome.remediated, names)} to ` +
            `create this audience.`,
        };
      } catch (secondErr) {
        if (!isEventSourcePermissionError(secondErr)) throw secondErr;
        // New information about Meta, not noise: a grant we verified landed did
        // not clear the refusal. Worth a log line before falling back.
        warn(`still refused after granting ${outcome.remediated.join(", ")}: ${errorText(secondErr)}`);
      }
    }

    // ── 2. salvage what is usable ────────────────────────────────────────────
    const { keep, drop } = splitSeedsByOffendingIds(options.requested, offending);
    if (keep.length === 0) {
      const why = outcome.skipped.map((s) => s.reason).find(Boolean);
      throw new Error(
        `${describeEventSourcePermissionFailure(drop.length ? drop : offending, names)}` +
          (why ? ` (${why})` : ""),
      );
    }

    const result = await options.create(keep);
    const why = outcome.skipped.map((s) => s.reason).find(Boolean);
    return {
      result,
      note:
        `Created from ${keep.length} of ${options.requested.length} sources. ` +
        `Meta refused ${labelList(drop, names)} — you hold no role on ` +
        `${drop.length === 1 ? "it" : "them"}${why ? ` (${why})` : ""}. Grant ` +
        `yourself ADVERTISE on ${drop.length === 1 ? "that page" : "those pages"} ` +
        `and retry to include ${drop.length === 1 ? "it" : "them"}.`,
    };
  }
}

function labelList(ids: string[], names: Record<string, string>): string {
  return ids.map((id) => (names[id] ? `${names[id]} (${id})` : id)).join(", ");
}

function errorText(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return err instanceof Error ? err.message : String(err);
}
