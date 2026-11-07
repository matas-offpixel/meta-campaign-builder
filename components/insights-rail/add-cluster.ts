/**
 * "Add cluster" (IR5): the rail adds an interest cluster to the audience
 * builder's draft and records the pick once through
 * increment_interest_cluster_use() (POST /api/interest-clusters/use, the
 * existing route). The builder reads the same store and marks each
 * cluster with the chip "added from Insights". A cluster added twice is
 * added and counted once.
 */

export type AddedCluster = { id: string; name: string; interests: { id: string; name: string }[]; addedAt: string };

export const ADD_CLUSTER_EVENT = "insights-rail:add-cluster";

let added: readonly AddedCluster[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EMPTY: readonly AddedCluster[] = [];

export function readAddedClusters(): readonly AddedCluster[] {
  return added;
}

/** For the React hook in use-added-clusters.ts; the store itself has no React in it. */
export const addedClustersStore = { subscribe, read: readAddedClusters, server: (): readonly AddedCluster[] => EMPTY };

export function isClusterAdded(id: string): boolean {
  return added.some((cluster) => cluster.id === id);
}

/** Frames and tests: start from a given list. */
export function seedAddedClusters(clusters: readonly AddedCluster[]): void {
  added = [...clusters];
  emit();
}

export type AddClusterOutcome = { added: boolean; counted: boolean };

/**
 * Adds the cluster to the draft and counts the pick. `post` is the fetch
 * that reaches /api/interest-clusters/use; tests hand in their own.
 */
export async function addClusterFromInsights(
  cluster: { id: string; name: string; interests: { id: string; name: string }[] },
  post: (id: string) => Promise<boolean> = postUse,
  now: () => string = () => new Date().toISOString(),
): Promise<AddClusterOutcome> {
  if (isClusterAdded(cluster.id)) return { added: false, counted: false };
  added = [...added, { id: cluster.id, name: cluster.name, interests: cluster.interests, addedAt: now() }];
  emit();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ADD_CLUSTER_EVENT, { detail: { id: cluster.id, name: cluster.name, interests: cluster.interests } }));
  }
  const counted = await post(cluster.id);
  return { added: true, counted };
}

async function postUse(id: string): Promise<boolean> {
  try {
    const res = await fetch("/api/interest-clusters/use", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
