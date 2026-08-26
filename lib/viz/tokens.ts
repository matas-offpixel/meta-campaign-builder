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

export function isVizAction(value: string): value is VizAction {
  return (VIZ_ACTIONS as readonly string[]).includes(value);
}

export function isVizStatus(value: string): value is VizStatus {
  return (VIZ_STATUSES as readonly string[]).includes(value);
}
