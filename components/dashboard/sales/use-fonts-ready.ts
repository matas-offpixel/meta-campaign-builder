"use client";

import { useSyncExternalStore } from "react";

/**
 * Bumps when the page's web fonts finish loading, so anything measured in
 * them (the chart's date labels, N1's 6 px rule) is fitted again in the real
 * font, not the fallback it first rendered in.
 */
let version = 0;

function subscribe(onChange: () => void): () => void {
  if (typeof document === "undefined" || !document.fonts) return () => {};
  const bump = () => {
    version += 1;
    onChange();
  };
  document.fonts.ready.then(bump).catch(() => {});
  document.fonts.addEventListener?.("loadingdone", bump);
  return () => document.fonts.removeEventListener?.("loadingdone", bump);
}

export function useFontsVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}
