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
