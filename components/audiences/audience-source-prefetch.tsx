"use client";

import { useEffect } from "react";

/**
 * Warms the server-side audience source cache when the user lands on the
 * client audiences tab, so opening "BUILD FUNNEL STACK" hits cache instead
 * of cold Graph fan-out from four simultaneous pickers.
 */
export function AudienceSourcePrefetch({ clientId }: { clientId: string }) {
  useEffect(() => {
    const q = `clientId=${encodeURIComponent(clientId)}`;
    const base = "/api/audiences/sources";
    void Promise.all([
      fetch(`${base}/pages?${q}`),
      fetch(`${base}/pixels?${q}`),
      fetch(`${base}/campaigns?${q}&limit=50`),
    ]);
  }, [clientId]);

  return null;
}
