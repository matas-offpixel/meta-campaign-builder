export type LaunchErrorSource = "preflight" | "meta" | "partial";

export const PREFLIGHT_LAUNCH_LEAD =
  "The launch was stopped before anything was sent to Meta.";

export const META_LAUNCH_LEAD =
  "Meta returned an error. Your draft has not been changed.";

export const PARTIAL_LAUNCH_LEAD =
  "Part of this launch was already sent to Meta. The draft was not fully published.";

const LAUNCH_ERROR_SOURCES = new Set<LaunchErrorSource>(["preflight", "meta", "partial"]);

export function isLaunchErrorSource(value: unknown): value is LaunchErrorSource {
  return typeof value === "string" && LAUNCH_ERROR_SOURCES.has(value as LaunchErrorSource);
}

/** Dialog lead. A missing source keeps the Meta wording. */
export function launchFailureLead(
  source: LaunchErrorSource | null | undefined,
): string {
  if (source === "preflight") return PREFLIGHT_LAUNCH_LEAD;
  if (source === "partial") return PARTIAL_LAUNCH_LEAD;
  return META_LAUNCH_LEAD;
}

/**
 * An explicit source wins. Status mapping (400 → preflight, 502 → meta)
 * applies only when the field is absent.
 */
export function resolveLaunchErrorSource(
  source: unknown,
  status: number,
): LaunchErrorSource {
  if (isLaunchErrorSource(source)) return source;
  if (status === 400) return "preflight";
  return "meta";
}

/**
 * Status fallback for a body that did not set source. Does not overwrite
 * a source the route already set.
 */
export function stampLaunchErrorSource<T extends Record<string, unknown>>(
  body: T,
  status: number,
): T & { source?: LaunchErrorSource } {
  if (status !== 400 && status !== 502 && !isLaunchErrorSource(body.source)) return body;
  return { ...body, source: resolveLaunchErrorSource(body.source, status) };
}
