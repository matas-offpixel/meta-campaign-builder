import { Button } from "@/components/ui/button";

import { StatusLine } from "./step-surface";

export function RotationAdSetNote({
  message,
  actions,
}: {
  message: string;
  actions?: Array<{ key: string; label: string; title?: string; onClick: () => void }>;
}) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
      <StatusLine tone="alert" className="text-xs font-medium text-destructive">
        {message}
      </StatusLine>
      {actions && actions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.key}
              type="button"
              variant="outline"
              size="sm"
              title={action.title}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
