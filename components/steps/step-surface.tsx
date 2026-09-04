"use client";

import { createContext, useContext, type ReactNode } from "react";

import { CardDescription as UiCardDescription } from "@/components/ui/card";

/**
 * A step renders inside a drawer (canvas sheet or `/campaign/[id]` page
 * variant). The old eight-step wizard surface is gone; `surface="drawer"`
 * is the only mount. Card descriptions still vanish here so a 2,400-line
 * panel keeps its controls and loses every sentence.
 */
export type StepSurface = "wizard" | "drawer";

const StepSurfaceContext = createContext<StepSurface>("drawer");

export function StepSurfaceProvider({
  surface,
  children,
}: {
  surface: StepSurface;
  children: ReactNode;
}) {
  return (
    <StepSurfaceContext.Provider value={surface}>{children}</StepSurfaceContext.Provider>
  );
}

export function useStepSurface(): StepSurface {
  return useContext(StepSurfaceContext);
}

export function useIsDrawer(): boolean {
  return useContext(StepSurfaceContext) === "drawer";
}

interface ChromeTextProps {
  children: ReactNode;
  className?: string;
  title?: string;
}

/**
 * A drop-in for `components/ui/card`'s `CardDescription`, which renders a
 * paragraph. Import this one so descriptions disappear in a drawer without
 * touching the shared card primitive.
 */
export function CardDescription(
  props: React.ComponentProps<typeof UiCardDescription>,
) {
  if (useIsDrawer()) return null;
  return <UiCardDescription {...props} />;
}

/**
 * Data that happens to live in a sentence — a page's name, a post's
 * caption, an ad-set count. Always a `span` so the zero-paragraph rule is
 * about standing sentences, not markup.
 */
export function Datum({ children, className, title }: ChromeTextProps) {
  return (
    <span className={`block ${className ?? ""}`} title={title}>
      {children}
    </span>
  );
}

/**
 * Status the operator must not lose: an upload that failed, a token that
 * expired, a fetch that came back empty. Always a `role="status"` span.
 */
export function StatusLine({
  children,
  className,
  title,
  tone = "status",
}: ChromeTextProps & {
  /** `alert` is announced immediately; `status` waits for a pause. */
  tone?: "status" | "alert";
}) {
  return (
    <span role={tone} className={`block ${className ?? ""}`} title={title}>
      {children}
    </span>
  );
}
