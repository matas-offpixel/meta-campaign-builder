/**
 * Shared visual language — colour tokens and aria copy for every
 * StatusDot / ActionGlyph / PlatformGlyph. One map so surfaces cannot
 * invent a second palette.
 */

export const VIZ_STATUSES = [
  "idle",
  "in-progress",
  "ready",
  "complete",
  "failed",
  "live",
  "paused",
] as const;

export type VizStatus = (typeof VIZ_STATUSES)[number];

export const VIZ_STATUS_TOKEN: Record<VizStatus, string> = {
  idle: "bg-muted-foreground/40",
  "in-progress": "bg-primary",
  ready: "bg-success/70",
  complete: "bg-success",
  failed: "bg-destructive",
  live: "bg-success",
  paused: "bg-warning",
};

export const VIZ_STATUS_LABEL: Record<VizStatus, string> = {
  idle: "Idle",
  "in-progress": "In progress",
  ready: "Ready",
  complete: "Complete",
  failed: "Failed",
  live: "Live",
  paused: "Paused",
};

export const VIZ_PLATFORMS = ["meta", "tiktok", "google"] as const;
export type VizPlatform = (typeof VIZ_PLATFORMS)[number];

export const VIZ_PLATFORM_LABEL: Record<VizPlatform, string> = {
  meta: "Meta",
  tiktok: "TikTok",
  google: "Google",
};

/** Fill tokens for stacked bars — distinct from status / action colours. */
export const VIZ_PLATFORM_BAR: Record<VizPlatform, string> = {
  meta: "bg-sky-500",
  tiktok: "bg-fuchsia-500",
  google: "bg-amber-500",
};

export const VIZ_PROVENANCES = [
  "platform-reported",
  "first-party",
  "manual entry",
  "modelled",
  "not instrumented",
] as const;

export type VizProvenance = (typeof VIZ_PROVENANCES)[number];

export const VIZ_PROVENANCE_MARK: Record<VizProvenance, string> = {
  "platform-reported": "plat",
  "first-party": "1P",
  "manual entry": "man",
  modelled: "mod",
  "not instrumented": "—",
};

export const VIZ_PROVENANCE_TOKEN: Record<VizProvenance, string> = {
  "platform-reported": "bg-sky-500/15 text-sky-800 dark:text-sky-200",
  "first-party": "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  "manual entry": "bg-amber-500/15 text-amber-900 dark:text-amber-200",
  modelled: "bg-violet-500/15 text-violet-800 dark:text-violet-200",
  "not instrumented":
    "border border-dashed border-border bg-transparent text-muted-foreground",
};

export const VIZ_DELTA_TONES = ["above", "below", "neutral", "none"] as const;
export type VizDeltaTone = (typeof VIZ_DELTA_TONES)[number];

export const VIZ_DELTA_TOKEN: Record<VizDeltaTone, string> = {
  above: "text-success",
  below: "text-warning",
  neutral: "text-muted-foreground",
  none: "text-muted-foreground",
};

export const VIZ_ACTIONS = [
  "scale_up",
  "scale_down",
  "maintain",
  "pause",
  "skip_dormant",
  "skip_recent_touch",
  "metric_unavailable",
] as const;

export type VizAction = (typeof VIZ_ACTIONS)[number];

export const VIZ_ACTION_LABEL: Record<VizAction, string> = {
  scale_up: "Scale up",
  scale_down: "Reduce",
  maintain: "Maintain",
  pause: "Pause",
  skip_dormant: "Dormant",
  skip_recent_touch: "Recent touch",
  metric_unavailable: "Metric unavailable",
};

export const VIZ_ACTION_TOKEN: Record<VizAction, string> = {
  scale_up: "text-success",
  scale_down: "text-warning",
  maintain: "text-muted-foreground",
  pause: "text-destructive",
  skip_dormant: "text-muted-foreground",
  skip_recent_touch: "text-muted-foreground",
  metric_unavailable: "text-muted-foreground",
};

export const VIZ_ACTION_GLYPH: Record<VizAction, string> = {
  scale_up: "▲",
  scale_down: "▼",
  maintain: "—",
  pause: "⏸",
  skip_dormant: "·",
  skip_recent_touch: "·",
  metric_unavailable: "◌",
};

export function isVizPlatform(value: string): value is VizPlatform {
  return (VIZ_PLATFORMS as readonly string[]).includes(value);
}

export function isVizAction(value: string): value is VizAction {
  return (VIZ_ACTIONS as readonly string[]).includes(value);
}

export function isVizStatus(value: string): value is VizStatus {
  return (VIZ_STATUSES as readonly string[]).includes(value);
}
