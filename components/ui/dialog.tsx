"use client";

import {
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
} from "react";
import { X } from "lucide-react";

/**
 * Hand-rolled dialog primitive.
 *
 * Mirrors the existing modal pattern (see SaveTemplateModal) but pulls
 * the boilerplate — overlay click, ESC key, body scroll lock, initial
 * focus, focus return — into a reusable shell so feature modals only
 * have to render their content.
 *
 * Intentionally minimal: no portal, no full focus trap library. The
 * project doesn't ship Radix/shadcn and we don't want to introduce a
 * new runtime dependency for one screen. If we ever need a true focus
 * trap (multi-modal stacking, complex tab order) this is the place to
 * add it.
 *
 * Usage:
 *   <Dialog open={open} onClose={() => setOpen(false)}>
 *     <DialogContent>
 *       <DialogHeader>
 *         <DialogTitle>Title</DialogTitle>
 *         <DialogDescription>Optional subtext</DialogDescription>
 *       </DialogHeader>
 *       …body…
 *       <DialogFooter>
 *         <Button>Action</Button>
 *       </DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 */

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /**
   * Optional label that screen readers announce when the dialog opens.
   * Falls back to the visible <DialogTitle> via aria-labelledby when
   * omitted. Provide one when the title is decorative-only.
   */
  ariaLabel?: string;
}

export function Dialog({ open, onClose, children, ariaLabel }: DialogProps) {
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ESC to close + body scroll lock + focus management.
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the first focusable element inside the panel so keyboard
    // users land somewhere sensible. Defer one tick so the panel is
    // mounted and any autofocus on a child (Input.autoFocus etc.)
    // wins over this generic handler.
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelector<HTMLElement>(
        'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 0);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(focusTimer);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : "dialog-title"}
    >
      <div
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div ref={panelRef} className="relative z-10 w-full max-w-md px-4">
        {children}
      </div>
    </div>
  );
}

interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function DialogContent({
  className = "",
  children,
  ...props
}: DialogContentProps) {
  return (
    <div
      className={`rounded-md border border-border bg-background p-6 shadow-md ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

interface DialogHeaderProps {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}

export function DialogHeader({
  children,
  onClose,
  className = "",
}: DialogHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-3 mb-5 ${className}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function DialogTitle({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <h2
      id="dialog-title"
      className={`font-heading text-xl tracking-wide text-foreground ${className}`}
    >
      {children}
    </h2>
  );
}

export function DialogDescription({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p className={`mt-1 text-sm text-muted-foreground ${className}`}>{children}</p>
  );
}

export function DialogFooter({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`mt-6 flex items-center justify-end gap-2 ${className}`}>
      {children}
    </div>
  );
}
