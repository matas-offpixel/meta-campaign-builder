"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowUpRight, CircleAlert, Info } from "lucide-react";

import {
  BLOCKER_BADGE_DISMISS,
  blockerRowFromIssue,
  type BlockerAnchor,
  type BlockerRowModel,
} from "@/lib/viz/blockers";

/**
 * Same #871 closer as OverflowMenu: portal, exempt trigger + panel,
 * defer the listener one tick so the opening click cannot close it,
 * Escape, and any drawer-open (BLOCKER_BADGE_DISMISS).
 *
 * The old absolute panel sat on top of the next channel row, so the
 * first click on TikTok `open ▸` hit the leftover popover instead.
 */
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
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const items = rows ?? (issues ?? []).map(blockerRowFromIssue);

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      const path = event.composedPath();
      if (rootRef.current && path.includes(rootRef.current)) return;
      if (panelRef.current && path.includes(panelRef.current)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onDismiss() {
      setOpen(false);
    }
    function onReposition() {
      place();
    }
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointer, true);
    }, 0);
    document.addEventListener("keydown", onKey);
    document.addEventListener(BLOCKER_BADGE_DISMISS, onDismiss);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener(BLOCKER_BADGE_DISMISS, onDismiss);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  if (items.length === 0) return null;

  const blockerCount = items.filter((row) => row.kind !== "advisory").length;
  const amber = blockerCount > 0;
  const aria =
    blockerCount > 0
      ? `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`
      : `${items.length} advisor${items.length === 1 ? "y" : "ies"}`;

  function onTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    place();
    setOpen((value) => !value);
  }

  const panel =
    open && typeof document !== "undefined" ? (
      <ul
        ref={panelRef}
        id={id}
        role="listbox"
        style={{
          position: "fixed",
          top: coords?.top ?? 0,
          right: coords?.right ?? 0,
          zIndex: 40,
        }}
        className="min-w-48 space-y-1 rounded-md border border-border bg-card p-2 shadow-md"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
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
                  onClick={() => setOpen(false)}
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
    ) : null;

  return (
    <div
      ref={rootRef}
      className="relative"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
          amber
            ? "bg-warning text-warning-foreground"
            : "bg-muted text-muted-foreground"
        }`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-label={aria}
        onClick={onTriggerClick}
      >
        {items.length}
      </button>
      {panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
