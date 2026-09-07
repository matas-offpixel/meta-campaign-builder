"use client";

import Link from "next/link";

import type { BlockerAnchor, BlockerRowModel } from "@/lib/viz/blockers";
import { VIZ_TYPE } from "@/lib/viz/tokens";

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
