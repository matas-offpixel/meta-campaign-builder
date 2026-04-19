"use client";

import type { ReactNode } from "react";

/**
 * Tiny inline banner used above the plan grid. Two variants share the
 * same skeleton; tone differs only in border / background / text colour.
 * Extracted because info (success) + error both render in the same
 * position with the same dismiss affordance.
 */

type Variant = "info" | "error";

const TONE: Record<Variant, string> = {
  info: "border-success bg-success/10 text-foreground",
  error: "border-destructive bg-destructive/10 text-destructive",
};

const DISMISS_TONE: Record<Variant, string> = {
  info: "text-muted-foreground hover:text-foreground",
  error: "text-destructive/70 hover:text-destructive",
};

export function PlanInlineBanner({
  variant,
  children,
  onDismiss,
}: {
  variant: Variant;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs ${TONE[variant]}`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className={`shrink-0 ${DISMISS_TONE[variant]}`}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
