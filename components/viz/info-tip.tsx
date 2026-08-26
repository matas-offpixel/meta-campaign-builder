import { CircleHelp } from "lucide-react";

/** Furniture copy lives here — never as a standing sentence. */
export function InfoTip({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground ${className}`}
      title={label}
      aria-label={label}
    >
      <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}
