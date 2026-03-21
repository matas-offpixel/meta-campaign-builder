import type { ReactNode } from "react";

type BadgeVariant = "default" | "primary" | "success" | "warning" | "destructive" | "outline";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-muted text-foreground",
  primary: "bg-primary/20 text-primary-hover",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  outline: "border border-border-strong text-foreground bg-transparent",
};

interface BadgeProps {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
  onRemove?: () => void;
}

export function Badge({ variant = "default", className = "", children, onRemove }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium
        ${variantClasses[variant]} ${className}`}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-foreground/10"
        >
          ×
        </button>
      )}
    </span>
  );
}
