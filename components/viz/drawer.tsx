"use client";

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import type { VizPlatform, VizStatus } from "@/lib/viz/tokens";

import { PlatformGlyph } from "./platform-glyph";
import { StatusDot } from "./status-dot";

export type DrawerTab = { id: string; glyph: ReactNode; label: string };

/**
 * Side sheet over the page — no route change. Outside-click closer
 * exempts the trigger and defers subscription one tick (React 19 —
 * same #871 pattern as overflow-menu.tsx).
 */
export function Drawer({
  open,
  platform,
  tabs,
  activeTab,
  onTabChange,
  status,
  onDone,
  onLoadTemplate,
  triggerRef,
  children,
}: {
  open: boolean;
  platform: VizPlatform;
  tabs: DrawerTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  status: VizStatus;
  onDone: () => void;
  onLoadTemplate?: () => void;
  triggerRef?: RefObject<Element | null>;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    const first = sheet?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    first?.focus();

    function onPointer(event: PointerEvent) {
      const path = event.composedPath();
      if (sheetRef.current && path.includes(sheetRef.current)) return;
      if (triggerRef?.current && path.includes(triggerRef.current)) return;
      onDone();
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onDone();
    }
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointer, true);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onDone, triggerRef]);

  function onSheetKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !sheetRef.current) return;
    const focusable = [
      ...sheetRef.current.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ),
    ].filter((node) => !node.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open || typeof document === "undefined") return null;

  const sheet = (
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-md md:w-[28rem] max-md:inset-0"
      onKeyDown={onSheetKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span id={titleId}>
          <PlatformGlyph platform={platform} size="md" />
        </span>
        <nav className="flex min-w-0 flex-1 items-center gap-1" aria-label="drawer tabs">
          {tabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] ${
                  active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60"
                }`}
                aria-current={active ? "page" : undefined}
                onClick={() => onTabChange(tab.id)}
              >
                <span aria-hidden="true">{tab.glyph}</span>
                {tab.label}
              </button>
            );
          })}
        </nav>
        <StatusDot status={status} />
        {onLoadTemplate ? (
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground"
            onClick={onLoadTemplate}
          >
            ⌁ template ▸
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{children}</div>
      <footer className="flex justify-end border-t border-border px-3 py-2">
        <button
          type="button"
          className="rounded-sm border border-border px-3 py-1 text-sm hover:bg-muted"
          onClick={onDone}
        >
          Done
        </button>
      </footer>
    </div>
  );

  return createPortal(sheet, document.body);
}
