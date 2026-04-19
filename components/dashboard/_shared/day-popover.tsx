"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Lightweight popover for the calendar's day cells.
 *
 * Intentionally minimal — no portal, no floating-ui, no focus trap. The
 * panel renders as an absolutely-positioned child of its parent (which
 * must be `position: relative`), so positioning piggybacks on the
 * grid cell and we never have to measure layout.
 *
 * Edge-awareness comes from `align` / `placement` props which the caller
 * derives from the cell's grid index — far cheaper than ResizeObserver
 * and good enough for a 7×6 month grid.
 *
 * Behaviour:
 * - Outside-click closes (mousedown phase, so a click on an inner link
 *   still navigates before close fires).
 * - Escape closes.
 * - On open, focus moves to the first interactive element inside the
 *   panel; the originating trigger is restored on close (no trap — Tab
 *   past the last element exits naturally).
 */

type Align = "left" | "right";
type Placement = "below" | "above";

interface Props {
  open: boolean;
  onClose: () => void;
  align?: Align;
  placement?: Placement;
  /** Accessible label for the panel itself. */
  ariaLabel?: string;
  children: ReactNode;
}

export function DayPopover({
  open,
  onClose,
  align = "left",
  placement = "below",
  ariaLabel,
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Remember the trigger so we can restore focus on close.
    previousActiveRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    // Focus the first interactive element inside the panel.
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    firstFocusable?.focus();

    function onMouseDown(ev: MouseEvent) {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose();
      }
    }

    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onClose();
      }
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      // Restore focus to the originating trigger.
      previousActiveRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const horizontal = align === "right" ? "right-0" : "left-0";
  const vertical =
    placement === "above" ? "bottom-full mb-1" : "top-full mt-1";

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      className={`absolute z-30 ${horizontal} ${vertical} w-72 max-w-[80vw] rounded-md border border-border bg-card p-3 shadow-lg`}
    >
      {children}
    </div>
  );
}
