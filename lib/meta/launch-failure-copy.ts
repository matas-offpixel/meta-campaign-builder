export type LaunchErrorSource = "preflight" | "meta";

export const PREFLIGHT_LAUNCH_LEAD =
  "The launch was stopped before anything was sent to Meta.";

export const META_LAUNCH_LEAD =
  "Meta returned an error. Your draft has not been changed.";

/** Dialog lead. A missing source keeps the Meta wording. */
export function launchFailureLead(
  source: LaunchErrorSource | null | undefined,
): string {
  return source === "preflight" ? PREFLIGHT_LAUNCH_LEAD : META_LAUNCH_LEAD;
}

/**
 * 400s are our refusals, before any campaign write. 502s are Meta's.
 * Other statuses are left unchanged.
 */
export function stampLaunchErrorSource<T extends Record<string, unknown>>(
  body: T,
  status: number,
): T & { source?: LaunchErrorSource } {
  if (status === 400) return { ...body, source: "preflight" };
  if (status === 502) return { ...body, source: "meta" };
  return body;
}
