"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

import { visibleOverflowMenuItems } from "@/lib/viz/overflow-menu";
import { VIZ_TYPE } from "@/lib/viz/tokens";

export interface OverflowMenuItem {
  id: string;
  icon: ReactNode;
  label: string;
  onSelect?: () => void;
  destructive?: boolean;
  hidden?: boolean;
}

/**
 * Cause of the #870 ⋯ dead-click: the menu lived as `absolute` under a
 * 32px relative root, and the document `mousedown` closer subscribed in
 * the same `open` effect turn. React 19 can flush that effect before the
 * opening gesture finishes, so `event.target` is outside `rootRef`
 * (row / card / document) and `open` flips straight back to false —
 * nothing in the a11y tree, no dialog, no console error.
 *
 * Fix: portal to document.body, ignore trigger + menu in the outside
 * check, and defer the listener one tick so the opening pointer cannot
 * close the menu.
 */
export function OverflowMenu({
  items,
  label = "More actions",
}: {
  items: OverflowMenuItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const visible = visibleOverflowMenuItems(items);

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }

  function onTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    place();
    setOpen((current) => !current);
  }

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      const path = event.composedPath();
      if (rootRef.current && path.includes(rootRef.current)) return;
      if (menuRef.current && path.includes(menuRef.current)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onReposition() {
      place();
    }
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointer, true);
    }, 0);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  const menu =
    open && typeof document !== "undefined" ? (
      <ul
        ref={menuRef}
        id={id}
        role="menu"
        style={{
          position: "fixed",
          top: coords?.top ?? 0,
          right: coords?.right ?? 0,
          zIndex: 40,
        }}
        className="min-w-[13rem] rounded-md border border-border bg-background py-1 shadow-md"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {visible.map((item) => (
          <li key={item.id} role="none">
            <button
              type="button"
              role="menuitem"
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${VIZ_TYPE.body} ${
                item.destructive
                  ? "text-destructive hover:bg-destructive/10"
                  : "text-foreground hover:bg-muted"
              }`}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onSelect?.();
              }}
            >
              <span className="inline-flex h-4 w-4 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">
                {item.icon}
              </span>
              {item.label}
            </button>
          </li>
        ))}
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
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={onTriggerClick}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
