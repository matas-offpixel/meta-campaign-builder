"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleAlert, Info } from "lucide-react";

import {
  blockerRowFromIssue,
  type BlockerAnchor,
  type BlockerRowModel,
} from "@/lib/viz/blockers";

export function BlockerBadge({
  issues,
  rows,
  onOpenAnchor,
}: {
  issues?: Array<{ id: string; message: string; href?: string | null }>;
  rows?: BlockerRowModel[];
  /** Drawer landing — when a row has `anchor`, click this instead of href. */
  onOpenAnchor?: (anchor: BlockerAnchor) => void;
}) {
  const [open, setOpen] = useState(false);
  const items = rows ?? (issues ?? []).map(blockerRowFromIssue);
  if (items.length === 0) return null;

  const blockerCount = items.filter((row) => row.kind !== "advisory").length;
  const amber = blockerCount > 0;
  const aria =
    blockerCount > 0
      ? `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`
      : `${items.length} advisor${items.length === 1 ? "y" : "ies"}`;

  return (
    <div className="relative">
      <button
        type="button"
        className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
          amber
            ? "bg-warning text-warning-foreground"
            : "bg-muted text-muted-foreground"
        }`}
        aria-expanded={open}
        aria-label={aria}
        onClick={() => setOpen((value) => !value)}
      >
        {items.length}
      </button>
      {open ? (
        <ul className="absolute right-0 z-20 mt-1 min-w-48 space-y-1 rounded-md border border-border bg-card p-2 shadow-md">
          {items.map((row) => {
            const advisory = row.kind === "advisory";
            const icon = advisory ? (
              <Info className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <CircleAlert className="h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
            );
            const body = (
              <>
                {icon}
                <span className={advisory ? "text-muted-foreground" : "text-foreground"}>
                  {row.label}
                </span>
                {row.href || row.anchor ? (
                  <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                ) : null}
                <span className="sr-only">{row.full}</span>
              </>
            );
            return (
              <li key={row.id}>
                {row.anchor && onOpenAnchor ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 text-left text-xs hover:underline"
                    title={row.full}
                    onClick={() => {
                      setOpen(false);
                      onOpenAnchor(row.anchor!);
                    }}
                  >
                    {body}
                  </button>
                ) : row.href ? (
                  <Link
                    href={row.href}
                    className="flex items-center gap-1.5 text-xs hover:underline"
                    title={row.full}
                  >
                    {body}
                  </Link>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs" title={row.full}>
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
