export function shortBlockerLabel(message: string, maxWords = 5): string {
  const words = message.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

export type BadgeRowKind = "blocker" | "advisory";

/** Drawer landing for a blocker row — click opens the sheet, not a route. */
export interface BlockerAnchor {
  drawer: import("./tokens.ts").VizPlatform;
  section: string;
}

export interface BlockerRowModel {
  id: string;
  label: string;
  full: string;
  href: string | null;
  kind?: BadgeRowKind;
  /** When set, BlockerBadge calls onOpenAnchor instead of navigating href. */
  anchor?: BlockerAnchor;
}

/** Drawer open (and Done) dismiss every portaled blocker popover. */
export const BLOCKER_BADGE_DISMISS = "offpixel:blocker-badge-dismiss";

export function dismissBlockerBadges(): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new Event(BLOCKER_BADGE_DISMISS));
}

/**
 * The click path a blocker badge must honour (#871, Chrome pass).
 * `open-other-row` is a click on another channel's `open ▸` while the
 * popover is up: the drawer opens and the popover is gone, and the
 * closer must not swallow that click.
 */
export type BlockerBadgeGesture =
  | "trigger"
  | "row"
  | "outside"
  | "escape"
  | "open-other-row"
  | "drawer-open";

export function blockerBadgeAfterGesture(
  gesture: BlockerBadgeGesture,
  row?: BlockerRowModel,
): {
  popoverOpen: boolean;
  openedAnchor: BlockerAnchor | null;
  openedDrawer: boolean;
  swallowsNextClick: boolean;
} {
  switch (gesture) {
    case "trigger":
      return {
        popoverOpen: true,
        openedAnchor: null,
        openedDrawer: false,
        swallowsNextClick: false,
      };
    case "row":
      return {
        popoverOpen: false,
        openedAnchor: row?.anchor ?? null,
        openedDrawer: Boolean(row?.anchor),
        swallowsNextClick: false,
      };
    case "outside":
    case "escape":
      return {
        popoverOpen: false,
        openedAnchor: null,
        openedDrawer: false,
        swallowsNextClick: false,
      };
    case "open-other-row":
      return {
        popoverOpen: false,
        openedAnchor: null,
        openedDrawer: true,
        swallowsNextClick: false,
      };
    case "drawer-open":
      return {
        popoverOpen: false,
        openedAnchor: null,
        openedDrawer: true,
        swallowsNextClick: false,
      };
  }
}

export function blockerRowFromIssue(issue: {
  id: string;
  message: string;
  href?: string | null;
}): BlockerRowModel {
  return {
    id: issue.id,
    label: shortBlockerLabel(issue.message),
    full: issue.message,
    href: issue.href ?? null,
  };
}

export function badgeRowFromIssue(
  issue: { id: string; message: string; href?: string | null },
  kind: BadgeRowKind,
): BlockerRowModel {
  return { ...blockerRowFromIssue(issue), kind };
}

/** Blockers first, then advisories. Same message is kept once (blocker wins). */
export function collectBadgeRows(
  blockers: Array<{ id: string; message: string; href?: string | null }>,
  advisories: Array<{ id: string; message: string; href?: string | null }>,
): BlockerRowModel[] {
  const seen = new Set<string>();
  const rows: BlockerRowModel[] = [];
  for (const issue of blockers) {
    const key = issue.message.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(badgeRowFromIssue(issue, "blocker"));
  }
  for (const issue of advisories) {
    const key = issue.message.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(badgeRowFromIssue(issue, "advisory"));
  }
  return rows;
}
