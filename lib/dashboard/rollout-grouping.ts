/**
 * lib/dashboard/rollout-grouping.ts
 *
 * Pure grouping logic for the `/clients/[id]/rollout` audit table.
 * Extracted from the view so it can be unit-tested without a React /
 * DOM test runner.
 *
 * Rules (from PR #114 follow-up brief):
 *   - Group rows that share **the same `event_code` AND `event_date`**
 *     (case-sensitive). Event codes are operator-controlled uppercase
 *     tokens so case-sensitive is the right default.
 *   - Only form a group when 2+ rows share the key. Singletons render
 *     as flat rows.
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

function groupKey(r: GroupableRow): string | null {
  if (!r.eventCode) return null;
  return `${r.eventCode}::${r.eventDate ?? ""}`;
}

export function buildRolloutGroups<TRow extends GroupableRow>(
  rows: TRow[],
): RolloutNode<TRow>[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = groupKey(r);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const out: RolloutNode<TRow>[] = [];

  for (const r of rows) {
    const k = groupKey(r);
    if (!k || (counts.get(k) ?? 0) < 2) {
      out.push({ kind: "single", row: r });
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);

    const children = rows.filter((c) => groupKey(c) === k);
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
        eventCode: r.eventCode as string,
        eventDate: r.eventDate ?? null,
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
