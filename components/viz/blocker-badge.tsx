"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleAlert } from "lucide-react";

import {
  blockerRowFromIssue,
  type BlockerRowModel,
} from "@/lib/viz/blockers";

export function BlockerBadge({
  issues,
  rows,
}: {
  issues?: Array<{ id: string; message: string; href?: string | null }>;
  rows?: BlockerRowModel[];
}) {
  const [open, setOpen] = useState(false);
  const items = rows ?? (issues ?? []).map(blockerRowFromIssue);
  if (items.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[10px] font-semibold text-warning-foreground"
        aria-expanded={open}
        aria-label={`${items.length} blocker${items.length === 1 ? "" : "s"}`}
        onClick={() => setOpen((value) => !value)}
      >
        {items.length}
      </button>
      {open ? (
        <ul className="absolute z-20 mt-1 min-w-48 space-y-1 rounded-md border border-border bg-card p-2 shadow-md">
          {items.map((row) => (
            <li key={row.id}>
              {row.href ? (
                <Link
                  href={row.href}
                  className="flex items-center gap-1.5 text-xs text-foreground hover:underline"
                  title={row.full}
                >
                  <CircleAlert className="h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
                  <span>{row.label}</span>
                  <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="sr-only">{row.full}</span>
                </Link>
              ) : (
                <span className="flex items-center gap-1.5 text-xs" title={row.full}>
                  <CircleAlert className="h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
                  <span>{row.label}</span>
                  <span className="sr-only">{row.full}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
