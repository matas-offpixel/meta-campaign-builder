/**
 * Saved interest clusters (table interest_clusters, migration 181).
 *
 * A cluster is a named set of Meta interests. Picking one copies its
 * interests into a new draft InterestGroup; the draft never references
 * the cluster again, so targeting, Generate and launch are unchanged.
 */

import type { InterestGroup } from "@/lib/types";

/** clients.vertical. */
export const CLIENT_VERTICALS = ["music", "football", "other"] as const;
export type ClientVertical = (typeof CLIENT_VERTICALS)[number];

/** interest_clusters.vertical. Lifestyle clusters show on every client. */
export const CLUSTER_VERTICALS = ["music", "football", "lifestyle", "other"] as const;
export type ClusterVertical = (typeof CLUSTER_VERTICALS)[number];

export const CLUSTER_SOURCES = ["seed", "library", "operator"] as const;
export type ClusterSource = (typeof CLUSTER_SOURCES)[number];

export interface InterestClusterInterest {
  id: string;
  name: string;
}

export interface InterestClusterEvidence {
  clusterKey?: string;
  adSets: number;
  /** Ad sets with at least £5 spend; the count the thin rule uses. */
  fundedAdSets?: number;
  /** GBP. */
  spend: number;
  registrations: number;
  /** GBP; null when the cluster recorded no registrations. */
  cpr: number | null;
  cprSource: "first_party" | "pixel";
  clients: string[];
  /** Cluster CPR ÷ the spend-weighted pooled CPR of its clients. */
  cprIndex: number | null;
  clientBaselineCpr?: number | null;
  confidence?: "thin";
  note?: string;
  dropped?: { id: string; name: string; reason: string }[];
}

export interface InterestCluster {
  id: string;
  name: string;
  vertical: ClusterVertical;
  interests: InterestClusterInterest[];
  evidence: InterestClusterEvidence | null;
  source: ClusterSource;
  /** Library names Meta interest search did not match; not in `interests`. */
  unresolved: string[];
  useCount: number;
  lastUsedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InterestClusterRow {
  id: string;
  name: string;
  vertical: string;
  interests: unknown;
  evidence: unknown;
  source: string;
  unresolved?: unknown;
  use_count: number | null;
  last_used_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export function isClusterVertical(value: unknown): value is ClusterVertical {
  return typeof value === "string" && (CLUSTER_VERTICALS as readonly string[]).includes(value);
}

export function isClientVertical(value: unknown): value is ClientVertical {
  return typeof value === "string" && (CLIENT_VERTICALS as readonly string[]).includes(value);
}

/** A draft with no client, or a client with no readable vertical, is music. */
export function effectiveClientVertical(vertical: ClientVertical | null | undefined): ClientVertical {
  return vertical ?? "music";
}

function isClusterSource(value: unknown): value is ClusterSource {
  return typeof value === "string" && (CLUSTER_SOURCES as readonly string[]).includes(value);
}

/** `[{id,name}]` with ids trimmed, blanks dropped, first occurrence kept. Names fall back to the id. */
export function normaliseClusterInterests(raw: unknown): InterestClusterInterest[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: InterestClusterInterest[] = [];
  for (const item of raw as { id?: unknown; name?: unknown }[]) {
    const id = item?.id == null ? "" : String(item.id).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : id;
    out.push({ id, name });
  }
  return out;
}

export function rowToInterestCluster(row: InterestClusterRow): InterestCluster {
  return {
    id: row.id,
    name: row.name,
    vertical: isClusterVertical(row.vertical) ? row.vertical : "other",
    interests: normaliseClusterInterests(row.interests),
    evidence: row.evidence && typeof row.evidence === "object" ? (row.evidence as InterestClusterEvidence) : null,
    source: isClusterSource(row.source) ? row.source : "operator",
    unresolved: Array.isArray(row.unresolved)
      ? row.unresolved.filter((n): n is string => typeof n === "string" && n.trim() !== "")
      : [],
    useCount: row.use_count ?? 0,
    lastUsedAt: row.last_used_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Sorted, de-duplicated interest ids joined by commas — the identity of a cluster. */
export function interestSetKey(interests: readonly { id: string }[]): string {
  return [...new Set(interests.map((i) => String(i.id).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .join(",");
}

/** The live (non-archived) cluster whose interest set equals these interests, if any. */
export function findClusterForInterests(
  clusters: readonly InterestCluster[],
  interests: readonly { id: string }[],
): InterestCluster | null {
  const key = interestSetKey(interests);
  if (!key) return null;
  return clusters.find((c) => !c.archivedAt && interestSetKey(c.interests) === key) ?? null;
}

/** True when some draft group already carries exactly this cluster's interest set. */
export function isClusterInGroups(cluster: InterestCluster, groups: readonly { interests: readonly { id: string }[] }[]): boolean {
  const key = interestSetKey(cluster.interests);
  return key !== "" && groups.some((g) => interestSetKey(g.interests) === key);
}

/** Pick a cluster into the draft: appends one new group, or returns the groups unchanged when already added. */
export function addClusterToGroups(
  groups: readonly InterestGroup[],
  cluster: InterestCluster,
  id: string,
): { groups: InterestGroup[]; added: InterestGroup | null } {
  if (isClusterInGroups(cluster, groups)) return { groups: [...groups], added: null };
  const added = groupFromCluster(cluster, id);
  return { groups: [...groups, added], added };
}

/** Live clusters of the client's vertical (music with no client) plus lifestyle. */
export function visibleClusters(
  clusters: readonly InterestCluster[],
  vertical: ClientVertical | null,
): InterestCluster[] {
  const v = effectiveClientVertical(vertical);
  return clusters.filter((c) => !c.archivedAt && (c.vertical === v || c.vertical === "lifestyle"));
}

export type ClusterSort = "most_used" | "best_cpr";

function byName(a: InterestCluster, b: InterestCluster): number {
  return a.name.localeCompare(b.name);
}

/**
 * Most used: use_count desc, then name.
 * Best CPR: measured clusters by cprIndex asc, then thin ("promising")
 * clusters by cprIndex, then clusters with no index by name.
 */
export function sortClusters(clusters: readonly InterestCluster[], mode: ClusterSort): InterestCluster[] {
  if (mode === "most_used") {
    return [...clusters].sort((a, b) => b.useCount - a.useCount || byName(a, b));
  }
  const tier = (c: InterestCluster) => {
    if (c.evidence?.cprIndex == null) return 2;
    return c.evidence.confidence === "thin" ? 1 : 0;
  };
  return [...clusters].sort((a, b) => {
    const t = tier(a) - tier(b);
    if (t) return t;
    const ai = a.evidence?.cprIndex ?? 0;
    const bi = b.evidence?.cprIndex ?? 0;
    return ai - bi || byName(a, b);
  });
}

export function formatGbpShort(value: number): string {
  if (value >= 1000) return `£${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

/** Ad sets the thin badge counts: funded ones when recorded. */
export function evidenceAdSets(evidence: InterestClusterEvidence): number {
  return evidence.fundedAdSets ?? evidence.adSets;
}

/** e.g. "12 ad sets · £2.4k · 311 regs · £7.72 CPR (first-party)". */
export function evidenceLine(evidence: InterestClusterEvidence | null): string | null {
  if (!evidence) return null;
  const parts = [
    `${evidence.adSets} ad set${evidence.adSets === 1 ? "" : "s"}`,
    formatGbpShort(evidence.spend),
    `${evidence.registrations.toLocaleString("en-GB")} regs`,
  ];
  if (evidence.cpr != null) {
    parts.push(`£${evidence.cpr.toFixed(2)} CPR (${evidence.cprSource === "first_party" ? "first-party" : "pixel"})`);
  }
  return parts.join(" · ");
}

export type ClusterSourceFilter = "all" | ClusterSource;

export const CLUSTER_SOURCE_FILTERS: readonly { value: ClusterSourceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "seed", label: "Seed" },
  { value: "library", label: "Library" },
  { value: "operator", label: "Yours" },
];

/** Manage dialog chips. Archived clusters stay in every filter. */
export function clustersForSourceFilter(
  clusters: readonly InterestCluster[],
  filter: ClusterSourceFilter,
): InterestCluster[] {
  return filter === "all" ? [...clusters] : clusters.filter((c) => c.source === filter);
}

/** e.g. "3 names not found on Meta: Graff, Bvlgari, Marshmello". */
export function unresolvedLine(cluster: Pick<InterestCluster, "unresolved">): string | null {
  const n = cluster.unresolved.length;
  if (!n) return null;
  return `${n} name${n === 1 ? "" : "s"} not found on Meta: ${cluster.unresolved.join(", ")}`;
}

/** A new draft group carrying the cluster's interests. */
export function groupFromCluster(cluster: InterestCluster, id: string): InterestGroup {
  return {
    id,
    name: cluster.name,
    nameSource: "generated",
    interests: cluster.interests.map((i) => ({ id: i.id, name: i.name })),
  };
}
