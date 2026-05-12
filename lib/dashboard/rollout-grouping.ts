/**
 * lib/dashboard/rollout-grouping.ts
 *
 * Pure grouping logic for the `/clients/[id]/rollout` audit table.
 * Extracted from the view so it can be unit-tested without a React /
 * DOM test runner.
 *
 * Rules (PR #114 + venue-series follow-up):
 *   - When **two or more** rows share the same `event_code`, they share one
 *     **series** key (`series:${event_code}`) — the budget unit — regardless
 *     of `venue_name` or `event_date`. Clients isolate cities/venues with
 *     distinct codes rather than splitting rows here.
 *   - Singleton code bucket (exactly one row with that code): key is
 *     `${event_code}::${event_date}` as before.
 *   - Rows without `event_code` are solo (`__solo__::${eventId}`).
 *   - Only form a group when 2+ rows share the same computed key.
 *     Singletons render as flat rows.
 *   - Parent row aggregates:
 *       • capacity = sum of children (null when every child is null)
 *       • ticketing = "Label (N)" when every child has the same mode,
 *         otherwise "Mixed (N)"
 *       • status = worst of `ready < partial < blocked`
 *       • shareCount = children where `hasShare === true`
 *   - Preserves input order (the SSR page sorts by `event_date desc`).
 */

import type {
  ReadinessStatus,
  ReadinessTicketingMode,
} from "@/lib/db/event-readiness";
import {
  extractKocVenuePrefix,
  isKocVenueFixtureCode,
} from "./venue-equal-split.ts";

/** Minimal shape needed to group; a structural subset of `RolloutRowProps`. */
export interface GroupableRow {
  eventId: string;
  eventCode: string | null;
  eventDate: string | null;
  venueName: string | null;
  capacity: number | null;
  ticketingMode: ReadinessTicketingMode;
  status: ReadinessStatus;
  missing: string[];
  warnings: string[];
  hasShare: boolean;
}

export interface RolloutGroupAggregate<TRow extends GroupableRow> {
  key: string;
  eventCode: string;
  eventDate: string | null;
  venueName: string | null;
  children: TRow[];
  /** Sum of child capacities; treat null children as 0. */
  capacity: number;
  /** True when every child had `capacity === null` — render as `—`. */
  capacityAllNull: boolean;
  /** Human label: e.g. `"Eventbrite (4)"` or `"Mixed (2)"`. */
  ticketingLabel: string;
  /** Worst readiness across children. */
  status: ReadinessStatus;
  /** Children that have a share link generated. */
  shareCount: number;
  /** Selection helpers. */
  childIds: string[];
  /** De-duped union of child missing / warnings for the parent tooltip. */
  aggregateMissing: string[];
  aggregateWarnings: string[];
}

export type RolloutNode<TRow extends GroupableRow> =
  | { kind: "single"; row: TRow }
  | { kind: "group"; group: RolloutGroupAggregate<TRow> };

const TICKETING_LABEL: Record<ReadinessTicketingMode, string> = {
  eventbrite: "Eventbrite",
  fourthefans: "4thefans",
  manual: "Manual",
  none: "None",
};

const STATUS_RANK: Record<ReadinessStatus, number> = {
  ready: 0,
  partial: 1,
  blocked: 2,
};

/**
 * KOC fixture codes (WC26-KOC-BRIXTON-ENG-CRO) must group by their
 * 3-part venue prefix (WC26-KOC-BRIXTON) — Meta campaigns are tagged
 * at venue level, not fixture level.
 * TODO: remove when allocator strategy registry lands (Task #73).
 */
function effectiveGroupCode(eventCode: string): string {
  return isKocVenueFixtureCode(eventCode)
    ? extractKocVenuePrefix(eventCode)
    : eventCode;
}

/**
 * Precompute stable grouping keys for every row. Used by rollout UI,
 * client-wide venue counts, and the share portal venue table so they
 * stay aligned.
 */
export function buildRolloutGroupKeyByEventId<TRow extends GroupableRow>(
  rows: TRow[],
): Map<string, string> {
  const out = new Map<string, string>();
  const byCode = new Map<string, TRow[]>();
  for (const r of rows) {
    if (!r.eventCode) continue;
    const gc = effectiveGroupCode(r.eventCode);
    const list = byCode.get(gc) ?? [];
    list.push(r);
    byCode.set(gc, list);
  }

  for (const r of rows) {
    if (!r.eventCode) {
      out.set(r.eventId, `__solo__::${r.eventId}`);
      continue;
    }
    const gc = effectiveGroupCode(r.eventCode);
    const bucket = byCode.get(gc) ?? [];
    const key =
      bucket.length >= 2
        ? `series:${gc}`
        : `${gc}::${r.eventDate ?? ""}`;
    out.set(r.eventId, key);
  }
  return out;
}

function aggregateParentEventDate(children: GroupableRow[]): string | null {
  const defined = children
    .map((c) => c.eventDate)
    .filter((d): d is string => d != null && d !== "");
  if (defined.length === 0) return null;
  const unique = new Set(defined);
  if (unique.size === 1) return [...unique][0]!;
  return null;
}

export function buildRolloutGroups<TRow extends GroupableRow>(
  rows: TRow[],
): RolloutNode<TRow>[] {
  const keyById = buildRolloutGroupKeyByEventId(rows);

  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = keyById.get(r.eventId);
    if (!k || k.startsWith("__solo__")) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const out: RolloutNode<TRow>[] = [];

  for (const r of rows) {
    const k = keyById.get(r.eventId);
    if (!k || (counts.get(k) ?? 0) < 2) {
      out.push({ kind: "single", row: r });
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);

    const children = rows.filter((c) => keyById.get(c.eventId) === k);
    let capacity = 0;
    let capacityAllNull = true;
    for (const c of children) {
      if (c.capacity != null) {
        capacity += c.capacity;
        capacityAllNull = false;
      }
    }

    const modes = new Set(children.map((c) => c.ticketingMode));
    const ticketingLabel =
      modes.size === 1
        ? `${TICKETING_LABEL[children[0].ticketingMode]} (${children.length})`
        : `Mixed (${children.length})`;

    let worst: ReadinessStatus = "ready";
    for (const c of children) {
      if (STATUS_RANK[c.status] > STATUS_RANK[worst]) worst = c.status;
    }

    const shareCount = children.filter((c) => c.hasShare).length;

    out.push({
      kind: "group",
      group: {
        key: k,
        eventCode: effectiveGroupCode(r.eventCode as string),
        eventDate: aggregateParentEventDate(children),
        venueName: children[0]?.venueName ?? null,
        children,
        capacity,
        capacityAllNull,
        ticketingLabel,
        status: worst,
        shareCount,
        childIds: children.map((c) => c.eventId),
        aggregateMissing: Array.from(
          new Set(children.flatMap((c) => c.missing)),
        ),
        aggregateWarnings: Array.from(
          new Set(children.flatMap((c) => c.warnings)),
        ),
      },
    });
  }
  return out;
}

/** Parse `#expanded=CODE1,CODE2` into a Set of event codes. Pure. */
export function parseExpandedHash(hash: string): Set<string> {
  const raw = hash.replace(/^#/, "");
  const params = new URLSearchParams(raw);
  const list = params.get("expanded");
  if (!list) return new Set();
  return new Set(
    list
      .split(",")
      .map((s) => {
        try {
          return decodeURIComponent(s.trim());
        } catch {
          return s.trim();
        }
      })
      .filter(Boolean),
  );
}

/** Serialise a Set back into `expanded=CODE1,CODE2` (no leading `#`). */
export function serializeExpandedHash(codes: Set<string>): string {
  if (codes.size === 0) return "";
  const params = new URLSearchParams();
  params.set(
    "expanded",
    Array.from(codes).map((c) => encodeURIComponent(c)).join(","),
  );
  return params.toString();
}
