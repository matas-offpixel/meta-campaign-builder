"use client";

import { CircleHelp, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

import { INFO_TIP_CLOSE_LABEL, INFO_TIP_OPEN } from "@/lib/viz/info-tip";
import { VIZ_TYPE } from "@/lib/viz/tokens";

/** Furniture copy lives here — never as a standing sentence. */
export function InfoTip({
  label,
  header,
  variant = "tip",
  className = "",
}: {
  label: string;
  header?: string;
  /** Both variants share one click / dismiss behaviour. */
  variant?: "tip" | "card";
  className?: string;
}) {
  void variant;
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({ top: rect.bottom + 4, left: rect.left });
  }

  function onTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    place();
    setOpen(true);
    document.dispatchEvent(new CustomEvent(INFO_TIP_OPEN, { detail: id }));
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
    function onOther(event: Event) {
      const other = (event as CustomEvent<string>).detail;
      if (other !== id) setOpen(false);
    }
    function onReposition() {
      place();
    }
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointer, true);
    }, 0);
    document.addEventListener("keydown", onKey);
    document.addEventListener(INFO_TIP_OPEN, onOther);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener(INFO_TIP_OPEN, onOther);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, id]);

  const panel =
    open && typeof document !== "undefined" ? (
      <span
        ref={panelRef}
        role="dialog"
        style={{
          position: "fixed",
          top: coords?.top ?? 0,
          left: coords?.left ?? 0,
          zIndex: 40,
        }}
        className="w-64 space-y-1.5 rounded-sm border border-border bg-card p-3 text-card-foreground shadow-sm"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="flex items-start justify-between gap-2">
          {header ? <span className={`${VIZ_TYPE.micro} block`}>{header}</span> : <span />}
          <button
            type="button"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
            aria-label={INFO_TIP_CLOSE_LABEL}
            onClick={() => setOpen(false)}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
        <span className={`${VIZ_TYPE.body} block`}>{label}</span>
      </span>
    ) : null;

  return (
    <span ref={rootRef} className={`relative inline-flex ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
        aria-label={header ? `${header}. ${label}` : label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onTriggerClick}
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {panel ? createPortal(panel, document.body) : null}
    </span>
  );
}
