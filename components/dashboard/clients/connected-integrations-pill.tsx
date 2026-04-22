"use client";

import { Check, Minus } from "lucide-react";

/**
 * components/dashboard/clients/connected-integrations-pill.tsx
 *
 * One-line at-a-glance status pill for the integrations a client has
 * connected. Surfaced on the client-detail Overview tab so Matas can
 * see at the top whether ticketing / D2C / creatives are already
 * wired up before clicking through to each tab.
 *
 * Intentionally minimal — this is a status indicator, not a launcher.
 * The dedicated tabs hold the configuration UI.
 */

export interface IntegrationStatus {
  label: string;
  /** True when at least one connection / template exists for this slot. */
  connected: boolean;
  /** Optional hover tooltip. */
  hint?: string;
}

interface Props {
  items: IntegrationStatus[];
}

export function ConnectedIntegrationsPill({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-border-strong bg-card px-3 py-1 text-[11px] text-muted-foreground">
      <span className="font-medium uppercase tracking-wider text-muted-foreground/80">
        Connected
      </span>
      <span className="text-muted-foreground/30">·</span>
      {items.map((item, idx) => (
        <span
          key={item.label}
          className="inline-flex items-center gap-1"
          title={item.hint ?? (item.connected ? "Connected" : "Not connected")}
        >
          <span
            className={
              item.connected ? "text-foreground" : "text-muted-foreground/60"
            }
          >
            {item.label}
          </span>
          {item.connected ? (
            <Check className="h-3 w-3 text-emerald-600" />
          ) : (
            <Minus className="h-3 w-3 text-muted-foreground/40" />
          )}
          {idx < items.length - 1 && (
            <span className="ml-1 text-muted-foreground/30">·</span>
          )}
        </span>
      ))}
    </div>
  );
}
