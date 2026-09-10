"use client";

import { createContext, useContext, type ReactNode } from "react";

import { CardDescription as UiCardDescription } from "@/components/ui/card";

/**
 * A step renders on the wizard ladder or inside a drawer (canvas sheet or
 * a standalone `/tiktok-campaign/[id]` / `/google-search/[id]` page).
 * `surface` is chrome — descriptions vanish in a drawer so a 2,400-line
 * panel keeps its controls and loses every sentence.
 *
 * `planOwnsDestination` is a different question: does a plan own the
 * destination URL? A drawer reused as a standalone page still has
 * `surface="drawer"` but no canvas, so the destination must stay editable.
 * Inner step providers inherit the flag when they omit it.
 */
export type StepSurface = "wizard" | "drawer";

type StepSurfaceValue = {
  surface: StepSurface;
  planOwnsDestination: boolean;
};

const StepSurfaceContext = createContext<StepSurfaceValue>({
  surface: "drawer",
  planOwnsDestination: false,
});

export function StepSurfaceProvider({
  surface,
  planOwnsDestination,
  children,
}: {
  surface: StepSurface;
  planOwnsDestination?: boolean;
  children: ReactNode;
}) {
  const parent = useContext(StepSurfaceContext);
  const value: StepSurfaceValue = {
    surface,
    planOwnsDestination: planOwnsDestination ?? parent.planOwnsDestination,
  };
  return (
    <StepSurfaceContext.Provider value={value}>{children}</StepSurfaceContext.Provider>
  );
}

export function useStepSurface(): StepSurface {
  return useContext(StepSurfaceContext).surface;
}

export function useIsDrawer(): boolean {
  return useContext(StepSurfaceContext).surface === "drawer";
}

export function usePlanOwnsDestination(): boolean {
  return useContext(StepSurfaceContext).planOwnsDestination;
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
