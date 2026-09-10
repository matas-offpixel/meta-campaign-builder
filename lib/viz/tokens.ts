/**
 * Shared visual language — colour tokens and aria copy for every
 * StatusDot / ActionGlyph / PlatformGlyph. One map so surfaces cannot
 * invent a second palette.
 *
 * Dates: `lib/viz/format-moment.ts` (not this file).
 */

/**
 * Four sizes, and only four. `display` is reserved for the one big
 * number a zone exists to answer — budget, target, and a LIVE
 * cost-per-stage. Anything else at display size destroys the hierarchy
 * it is there to create.
 */
export const VIZ_TYPE = {
  display: "text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
  body: "text-[14px] font-normal leading-[1.35]",
  label: "text-[12px] font-medium leading-[1.25] tracking-[0.01em]",
  micro: "text-[10px] font-medium uppercase leading-none tracking-[0.08em]",
} as const;

/** Same sizes with tabular figures — every numeric read. */
export const VIZ_TYPE_NUM = {
  body: `${VIZ_TYPE.body} tabular-nums`,
  label: `${VIZ_TYPE.label} tabular-nums`,
  micro: `${VIZ_TYPE.micro} tabular-nums`,
} as const;

/** Per-zone gutters — consumed by the canvas in PR 8b. */
export const VIZ_ZONE_GUTTER = {
  tight: "mt-4",
  normal: "mt-5",
  loose: "mt-6",
} as const;

/** Sand / ink hex — contrast tests measure against these, not Tailwind. */
export const VIZ_SAND_HEX = "#F0C9A8";
export const VIZ_INK_HEX = "#1e1810";

export const VIZ_PLATFORM_FILL: Record<"meta" | "tiktok" | "google", string> = {
  meta: "#759FBD",
  tiktok: "#BE7E9E",
  google: "#9E7AB8",
};

export const VIZ_PLATFORM_INK_HEX: Record<"meta" | "tiktok" | "google", string> = {
  meta: "#3F6783",
  tiktok: "#884466",
  google: "#66447E",
};

export const VIZ_STATUSES = [
  "idle",
  "in-progress",
  "ready",
  "complete",
  "failed",
  "live",
  "paused",
  "blocked",
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
  /** Blocked is not idle — idle reads "not started". Warning family, lighter than paused. */
  blocked: "bg-warning/70",
};

export const VIZ_STATUS_LABEL: Record<VizStatus, string> = {
  idle: "Idle",
  "in-progress": "In progress",
  ready: "Ready",
  complete: "Complete",
  failed: "Failed",
  live: "Live",
  paused: "Paused",
  blocked: "Blocked",
};

export const VIZ_PLATFORMS = ["meta", "tiktok", "google"] as const;
export type VizPlatform = (typeof VIZ_PLATFORMS)[number];

export const VIZ_PLATFORM_LABEL: Record<VizPlatform, string> = {
  meta: "Meta",
  tiktok: "TikTok",
  google: "Google",
};

/**
 * Platform identity — the ONE decorative use of colour left on the
 * canvas, and only on PlatformGlyph, SplitBar segments and the
 * ChannelRow glyph. 30–35% saturation so three tints sit in the sand
 * palette without shouting; L 60–62 so an ink label on a fill clears
 * 4.5:1. Google's brand quadcolour is unusable here — each of its four
 * collides with sand, --warning, --success or --destructive — so its
 * identity is the glyph plus a hue nobody else holds.
 *
 * Literals must stay complete (`bg-[#759FBD]`) so Tailwind sees them.
 */
export const VIZ_PLATFORM_BAR: Record<VizPlatform, string> = {
  meta: "bg-[#759FBD]",
  tiktok: "bg-[#BE7E9E]",
  google: "bg-[#9E7AB8]",
};

/** Darker same-hue for a 1.6px glyph stroke on sand (≥ 3:1 as a graphic). */
export const VIZ_PLATFORM_INK: Record<VizPlatform, string> = {
  meta: "text-[#3F6783]",
  tiktok: "text-[#884466]",
  google: "text-[#66447E]",
};

/** In-segment labels sit on the fill, so they are ink — never sand. */
export const VIZ_ON_PLATFORM_INK = "text-[#1e1810]";

export const VIZ_PROVENANCES = [
  "platform-reported",
  "first-party",
  "manual entry",
  "modelled",
  "derived",
  "derived-history",
  "starting-point",
  "venue-untidy",
  /** `lib/optimisation/presets.ts`'s fallback — a benchmark, not this client's. */
  "industry seed",
  "not instrumented",
] as const;

export type VizProvenance = (typeof VIZ_PROVENANCES)[number];

export const VIZ_PROVENANCE_MARK: Record<VizProvenance, string> = {
  "platform-reported": "plat",
  "first-party": "1P",
  "manual entry": "man",
  modelled: "mod",
  /** Derived keyword/creative — never reuse modelled (`mod`) for this. */
  derived: "⌁",
  "derived-history": "hist",
  "starting-point": "start",
  "venue-untidy": "venue",
  "industry seed": "seed",
  "not instrumented": "—",
};

/** Monochrome — the mark carries the distinction, not a hue. */
export const VIZ_PROVENANCE_TOKEN: Record<VizProvenance, string> = {
  "platform-reported": "bg-foreground/10 text-foreground/70",
  "first-party": "bg-foreground/10 text-foreground/70",
  "manual entry": "bg-foreground/[0.06] text-foreground/60",
  modelled: "bg-foreground/[0.06] text-foreground/60",
  derived: "bg-foreground/[0.06] text-foreground/60",
  "derived-history": "bg-foreground/[0.06] text-foreground/60",
  "starting-point": "bg-transparent text-foreground/50 border border-border",
  "venue-untidy": "bg-foreground/[0.06] text-foreground/60",
  "industry seed": "bg-transparent text-foreground/50 border border-border",
  "not instrumented":
    "border border-dashed border-border bg-transparent text-muted-foreground",
};

/** Words for the ⓘ and rare surfaces — never a daily read. */
export const VIZ_PROVENANCE_LABEL: Record<VizProvenance, string> = {
  "platform-reported": "{{platform}} says",
  "first-party": "our tag counted",
  "manual entry": "you entered",
  modelled: "our estimate",
  derived: "from your Meta campaign",
  "derived-history": "from {n} other shows at {venue}",
  "starting-point": "Off Pixel's starting point",
  "venue-untidy": "venue names need tidying",
  "industry seed": "Off Pixel's starting point",
  "not instrumented": "not measured yet",
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
  "skip_no_rules",
  "skip_not_delivering",
  "skip_campaign_ended",
  "skip_event_passed",
  "skip_phase_ended",
  "insufficient_conversions",
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
  skip_no_rules: "No rules",
  skip_not_delivering: "Not delivering",
  skip_campaign_ended: "Campaign ended",
  skip_event_passed: "Event passed",
  skip_phase_ended: "Phase ended",
  insufficient_conversions: "Insufficient conversions",
  metric_unavailable: "Metric unavailable",
};

export const VIZ_ACTION_TOKEN: Record<VizAction, string> = {
  scale_up: "text-success",
  scale_down: "text-warning",
  maintain: "text-muted-foreground",
  pause: "text-destructive",
  skip_dormant: "text-muted-foreground",
  skip_recent_touch: "text-muted-foreground",
  skip_no_rules: "text-muted-foreground",
  skip_not_delivering: "text-muted-foreground",
  skip_campaign_ended: "text-muted-foreground",
  skip_event_passed: "text-muted-foreground",
  skip_phase_ended: "text-muted-foreground",
  insufficient_conversions: "text-muted-foreground",
  metric_unavailable: "text-muted-foreground",
};

export const VIZ_ACTION_GLYPH: Record<VizAction, string> = {
  scale_up: "▲",
  scale_down: "▼",
  maintain: "—",
  pause: "⏸",
  skip_dormant: "·",
  skip_recent_touch: "·",
  skip_no_rules: "·",
  skip_not_delivering: "·",
  skip_campaign_ended: "·",
  skip_event_passed: "·",
  skip_phase_ended: "·",
  insufficient_conversions: "·",
  metric_unavailable: "◌",
};

/**
 * The three ways a number can be drawn. Solid = somebody counted it.
 *  Dashed = we worked it out from history. Empty = nothing yet, and the
 *  sentence says what would make it measurable. There is no fourth. */
export const VIZ_LINE_KINDS = ["measured", "estimated", "not-yet"] as const;
export type VizLineKind = (typeof VIZ_LINE_KINDS)[number];

export const VIZ_LINE_TOKEN: Record<VizLineKind, string> = {
  measured: "border-solid  opacity-100",
  estimated: "border-dashed opacity-100",
  "not-yet": "border-dashed opacity-35", // + the sentence, always
};
/** Their word for the ⓘ and rare surfaces — never rendered on a daily read. */
export const VIZ_LINE_WORD: Record<VizLineKind, string> = {
  measured: "measured",
  estimated: "estimated",
  "not-yet": "not measured yet",
};

export const VIZ_PROVENANCE_LINE_KIND: Record<VizProvenance, VizLineKind> = {
  "platform-reported": "measured",
  "first-party": "measured",
  "manual entry": "measured",
  modelled: "estimated",
  derived: "estimated",
  "derived-history": "estimated",
  "starting-point": "estimated",
  "venue-untidy": "estimated",
  "industry seed": "estimated",
  "not instrumented": "not-yet",
};

export function provenanceWord(
  provenance: VizProvenance,
  vars?: { platform?: VizPlatform | string; n?: number; venue?: string },
): string {
  let word = VIZ_PROVENANCE_LABEL[provenance];
  const platformName = vars?.platform
    ? isVizPlatform(vars.platform)
      ? VIZ_PLATFORM_LABEL[vars.platform]
      : vars.platform
    : "Meta";
  word = word.replace("{{platform}}", platformName);
  if (vars?.n != null) word = word.replace("{n}", String(vars.n));
  if (vars?.venue) word = word.replace("{venue}", vars.venue);
  return word;
}

export const VIZ_STATE_WORD = {
  ready: "ready",
  running: "running",
  needsYou: "needs you",
  paused: "paused",
  done: "done",
} as const;

export const VIZ_ACTION_WORD: Record<VizAction, { suggest: string; did: string }> = {
  scale_up: { suggest: "raise", did: "raised" },
  scale_down: { suggest: "lower", did: "lowered" },
  maintain: { suggest: "keep", did: "left alone" },
  pause: { suggest: "pause", did: "paused" },
  skip_dormant: { suggest: "—", did: "left alone — no spend for {days} days" },
  skip_recent_touch: { suggest: "—", did: "left alone — changed {hours}h ago" },
  skip_no_rules: { suggest: "—", did: "left alone — no rules" },
  skip_not_delivering: { suggest: "—", did: "left alone — not delivering" },
  skip_campaign_ended: { suggest: "—", did: "left alone — campaign ended" },
  skip_event_passed: { suggest: "—", did: "left alone — event has passed" },
  skip_phase_ended: { suggest: "—", did: "left alone — phase has ended" },
  insufficient_conversions: { suggest: "—", did: "left alone — {n} of {min} {unit}s needed" },
  metric_unavailable: { suggest: "—", did: "no reads yet" },
};

export const VIZ_UNIT_WORD = {
  reg: "signup",
  click: "click",
  lpv: "page view",
  purchase: "purchase",
  view: "thousand reached",
  /** Display word for the tickets_sold line of the purchase unit. Not a stored target_unit. */
  ticket: "ticket",
} as const;

/** The purchase unit has two lines; the second line's word is the ticketing source's. */
export const VIZ_TICKET_LINE_WORD = {
  manual: "you entered",
  xlsx_import: "from the xlsx",
  eventbrite: "from Eventbrite",
  fourthefans: "from 4TheFans",
  none: "not entered yet",
  unknown: "source not recorded",
} as const;

/** Ink alphas for the new fills — contrast tests measure these, not Tailwind. */
export const VIZ_INK_FILL = {
  outline: 0.6,
  notYet: 0.35,
  border: 0.1,
  muted: 0.06,
} as const;

export const VIZ_LOCKED_CLIENT_CREATIVE =
  "not measured yet — creative results are scored after your first finished show";

const CLIENT_UNSAFE = /\b(table|flag|pipeline|ENABLE_[A-Z0-9_]+)\b/i;

/** Under role=client, system sentences may not name a table, flag or pipeline. */
export function VIZ_CLIENT_SAFE(sentence: string): string {
  return CLIENT_UNSAFE.test(sentence) ? VIZ_LOCKED_CLIENT_CREATIVE : sentence;
}

export function isVizPlatform(value: string): value is VizPlatform {
  return (VIZ_PLATFORMS as readonly string[]).includes(value);
}

export function isVizAction(value: string): value is VizAction {
  return (VIZ_ACTIONS as readonly string[]).includes(value);
}

export function isVizStatus(value: string): value is VizStatus {
  return (VIZ_STATUSES as readonly string[]).includes(value);
}

export function isVizLineKind(value: string): value is VizLineKind {
  return (VIZ_LINE_KINDS as readonly string[]).includes(value);
}
