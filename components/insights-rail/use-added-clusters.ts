import { useSyncExternalStore } from "react";

import { addedClustersStore, type AddedCluster } from "@/components/insights-rail/add-cluster";

/** The clusters the rail added to this page's draft (IR5). */
export function useAddedClusters(): readonly AddedCluster[] {
  return useSyncExternalStore(addedClustersStore.subscribe, addedClustersStore.read, addedClustersStore.server);
}
