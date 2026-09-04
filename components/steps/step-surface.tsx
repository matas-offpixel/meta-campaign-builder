"use client";

import { createContext, useContext, type ReactNode } from "react";

import { CardDescription as UiCardDescription } from "@/components/ui/card";

/**
 * A wizard step renders on one of two surfaces.
 *
 * `wizard` is the eight-step page it was written for. `drawer` is the Meta
 * drawer (PR 4), where the canvas already carries the event, the window, the
 * budget and the target — so a step's own header, its card descriptions, its
 * banners and its explanatory sentences are all repeating something the
 * operator can already see, and go.
 *
 * A step opts in with one `surface` prop at its boundary and provides this
 * context; nothing below it is threaded, so a 2,400-line panel keeps its
 * internals and still loses its chrome.
 */
export type StepSurface = "wizard" | "drawer";

const StepSurfaceContext = createContext<StepSurface>("wizard");

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

/**
 * Explanatory copy — the sentences that tell the operator what a control is
 * for. Renders as the `<p>` it has always been on the wizard, and as nothing
 * at all in a drawer.
 *
 * PR 7 deletes every call site: on the wizard these sentences are the 93 the
 * redesign counted, and once the drawer is the only Meta surface there is no
 * reader left. Until then this is the one place that decides.
 */
export function Prose({ children, className, title }: ChromeTextProps) {
  if (useIsDrawer()) return null;
  return (
    <p className={className} title={title}>
      {children}
    </p>
  );
}

interface ChromeTextProps {
  children: ReactNode;
  className?: string;
  title?: string;
}

/**
 * Block chrome — a step's own heading, a card description, a banner, a
 * callout. Same rule as `Prose`, but for a subtree rather than a sentence.
 */
export function Chrome({ children }: { children: ReactNode }) {
  if (useIsDrawer()) return null;
  return <>{children}</>;
}

/**
 * A drop-in for `components/ui/card`'s `CardDescription`, which renders a
 * `<p>`. A step imports this one instead and its descriptions disappear in
 * the drawer without 31 call sites each growing a wrapper — and without
 * touching the shared card primitive, which other surfaces still rely on.
 */
export function CardDescription(
  props: React.ComponentProps<typeof UiCardDescription>,
) {
  if (useIsDrawer()) return null;
  return <UiCardDescription {...props} />;
}

/**
 * Data that happens to live in a `<p>` — a page's name, a post's caption,
 * an ad-set count. It is the operator's information, not chrome, so it
 * renders on both surfaces; in a drawer it drops to a `span` so the
 * zero-`<p>` rule can be about sentences rather than about markup.
 *
 * This is the default the chrome codemod chose when it could not prove a
 * `<p>` was explanatory, because a surviving sentence is cosmetic and a
 * vanished page name is a bug.
 */
export function Datum({ children, className, title }: ChromeTextProps) {
  if (useIsDrawer()) {
    return (
      <span className={`block ${className ?? ""}`} title={title}>
        {children}
      </span>
    );
  }
  return (
    <p className={className} title={title}>
      {children}
    </p>
  );
}

/**
 * Status the operator must not lose: an upload that failed, a token that
 * expired, a fetch that came back empty. These read like prose but they are
 * evidence, so the drawer keeps them — as a `role="status"` span rather than
 * a `<p>`, which is what lets the drawer honestly claim zero standing
 * sentences while still telling the operator what went wrong.
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
  if (useIsDrawer()) {
    return (
      <span role={tone} className={`block ${className ?? ""}`} title={title}>
        {children}
      </span>
    );
  }
  return (
    <p role={tone} className={className} title={title}>
      {children}
    </p>
  );
}
