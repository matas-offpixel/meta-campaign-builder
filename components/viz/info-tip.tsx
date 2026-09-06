"use client";

import { CircleHelp } from "lucide-react";
import { useState } from "react";

import { VIZ_TYPE } from "@/lib/viz/tokens";

/** Furniture copy lives here — never as a standing sentence. */
export function InfoTip({
  label,
  header,
  variant = "tip",
  className = "",
}: {
  label: string;
  header?: string;
  variant?: "tip" | "card";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (variant === "card") {
    return (
      <span className={`relative inline-flex ${className}`}>
        <button
          type="button"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
          aria-label={header ? `${header}. ${label}` : label}
          aria-expanded={open}
          onClick={() => setOpen((next) => !next)}
        >
          <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {open ? (
          <span
            role="dialog"
            className="absolute left-0 top-5 z-20 w-64 space-y-1.5 rounded-sm border border-border bg-card p-3 text-card-foreground shadow-sm"
          >
            {header ? <span className={`${VIZ_TYPE.micro} block`}>{header}</span> : null}
            <span className={`${VIZ_TYPE.body} block`}>{label}</span>
          </span>
        ) : null}
      </span>
    );
  }
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
