import type { ReactNode } from "react";

/**
 * Shared header strip for dashboard pages. Keeps spacing + typography
 * consistent across Today / Calendar / Clients / Events / Reporting / Settings.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-border bg-card px-6 py-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl tracking-wide truncate">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * Simple empty-state for placeholder routes and CRUD lists.
 */
export function ComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <div className="text-center max-w-md px-6">
        <p className="font-heading text-xl tracking-wide">{title}</p>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
