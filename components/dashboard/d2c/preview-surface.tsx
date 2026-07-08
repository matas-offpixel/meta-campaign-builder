"use client";

import { useEffect, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";

import {
  D2C_PREVIEW_VIEWPORT_STORAGE_KEY,
  normaliseViewport,
  viewportClamp,
  type PreviewViewport,
} from "@/lib/d2c/dashboard-view";

/**
 * components/dashboard/d2c/preview-surface.tsx
 *
 * Page-level Desktop/Phone viewport toggle for the send previews (Goal 3).
 * Holds the viewport state so ALL preview cards switch together, persists the
 * choice to localStorage, and clamps the preview column width. Rendered on
 * both the operator page and the public share view.
 */
export function PreviewSurface({ children }: { children: React.ReactNode }) {
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");

  useEffect(() => {
    // One-time sync of the persisted choice from localStorage on mount — a
    // legitimate external-system read (SSR always renders the "desktop"
    // default; the client reconciles here).
    try {
      const stored = window.localStorage.getItem(D2C_PREVIEW_VIEWPORT_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage hydration on mount
      setViewport(normaliseViewport(stored));
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  function choose(next: PreviewViewport) {
    setViewport(next);
    try {
      window.localStorage.setItem(D2C_PREVIEW_VIEWPORT_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const pill = (mode: PreviewViewport, label: string, Icon: typeof Monitor) => {
    const active = viewport === mode;
    return (
      <button
        type="button"
        onClick={() => choose(mode)}
        aria-pressed={active}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          active
            ? "bg-foreground text-background"
            : "border border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        <Icon size={14} aria-hidden />
        {label}
      </button>
    );
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-end gap-2">
        {pill("desktop", "Desktop", Monitor)}
        {pill("phone", "Phone", Smartphone)}
      </div>
      <div className="mx-auto w-full transition-[max-width] duration-200" style={{ maxWidth: viewportClamp(viewport) }}>
        {children}
      </div>
    </div>
  );
}
