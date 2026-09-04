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
  variant = "sheet",
  header,
  footer,
  doneLabel = "Done",
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
  /**
   * `sheet` is the side sheet over the canvas. `page` is the same shell
   * rendered in the document flow, for a draft with no canvas behind it
   * (`/campaign/[id]`) — no portal, no modal semantics, no esc-to-close,
   * because there is nothing underneath to go back to.
   */
  variant?: "sheet" | "page";
  /** Extra header content, right of the tabs — e.g. the attach mode. */
  header?: ReactNode;
  /** Extra footer content, left of Done — e.g. a save-status indicator. */
  footer?: ReactNode;
  doneLabel?: string;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open || variant === "page") return;
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
  }, [open, onDone, triggerRef, variant]);

  function onSheetKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // A page has somewhere else to tab to; a sheet does not.
    if (variant === "page") return;
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

  if (!open) return null;
  const page = variant === "page";
  if (!page && typeof document === "undefined") return null;

  const sheet = (
    <div
      ref={sheetRef}
      role={page ? "region" : "dialog"}
      aria-modal={page ? undefined : "true"}
      aria-labelledby={titleId}
      className={
        page
          ? "flex min-h-0 flex-col rounded-md border border-border bg-background"
          : "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-md md:w-[34rem] max-md:inset-0"
      }
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
        {header}
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
      <div
        className={
          page ? "px-3 py-3" : "min-h-0 flex-1 overflow-y-auto px-3 py-3"
        }
      >
        {children}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
        {footer}
        <button
          type="button"
          className="rounded-sm border border-border px-3 py-1 text-sm hover:bg-muted"
          onClick={onDone}
        >
          {doneLabel}
        </button>
      </footer>
    </div>
  );

  return page ? sheet : createPortal(sheet, document.body);
}
