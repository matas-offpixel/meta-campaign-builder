"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export interface OverflowMenuItem {
  id: string;
  icon: ReactNode;
  label: string;
  onSelect?: () => void;
  destructive?: boolean;
  hidden?: boolean;
}

export function OverflowMenu({
  items,
  label = "More actions",
}: {
  items: OverflowMenuItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const visible = items.filter((item) => !item.hidden);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <ul
          id={id}
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-[13rem] rounded-md border border-border bg-background py-1 shadow-md"
        >
          {visible.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  item.destructive
                    ? "text-destructive hover:bg-destructive/10"
                    : "text-foreground hover:bg-muted"
                }`}
                onClick={() => {
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
      ) : null}
    </div>
  );
}
