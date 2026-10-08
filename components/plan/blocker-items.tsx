"use client";

import Link from "next/link";

import { PlatformGlyph } from "@/components/viz/platform-glyph";
import type { LaunchBlockerGroup } from "@/lib/plan/launch-face";
import type { BlockerAnchor, BlockerRowModel } from "@/lib/viz/blockers";
import { VIZ_TYPE } from "@/lib/viz/tokens";

/**
 * Launch blockers by channel. Each channel is a disclosure, closed until
 * opened, so a plan with twenty blockers is three lines, not a column.
 */
export function PlanBlockerGroups({
  groups,
  onOpenAnchor,
}: {
  groups: readonly LaunchBlockerGroup[];
  onOpenAnchor?: (anchor: BlockerAnchor) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div data-blocker-groups className="divide-y divide-border rounded-md border border-border">
      {groups.map((group) => (
        <details key={group.adapter} data-blocker-group={group.adapter} className="group px-3 py-2">
          <summary
            className={`flex cursor-pointer list-none items-center gap-2 ${VIZ_TYPE.label} text-foreground`}
          >
            <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90">
              ▸
            </span>
            <PlatformGlyph platform={group.adapter} size="sm" />
            {group.label}
            <span className="text-muted-foreground">
              {group.count === 1 ? "1 to fix" : `${group.count} to fix`}
            </span>
          </summary>
          <div className="mt-1.5 pl-5">
            <PlanBlockerItems items={group.rows} onOpenAnchor={onOpenAnchor} />
          </div>
        </details>
      ))}
    </div>
  );
}

/**
 * The list behind a "N things to fix" count. The count stays the heading;
 * each item is the cure, with a link.
 */
export function PlanBlockerItems({
  items,
  onOpenAnchor,
}: {
  items: readonly BlockerRowModel[];
  onOpenAnchor?: (anchor: BlockerAnchor) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {items.map((row) => {
        const body = <span className={`${VIZ_TYPE.body} text-foreground`}>{row.full}</span>;
        return (
          <li key={row.id}>
            {row.anchor && onOpenAnchor ? (
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => onOpenAnchor(row.anchor!)}
              >
                {body}
              </button>
            ) : row.href ? (
              <Link href={row.href} className="hover:underline">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
