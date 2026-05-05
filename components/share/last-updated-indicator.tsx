"use client";

import type { PortalEvent } from "@/lib/db/client-portal-server";

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function LastUpdatedIndicator({
  iso,
  className = "",
}: {
  iso: string | null;
  className?: string;
}) {
  return (
    <span
      className={`text-[11px] font-medium tabular-nums ${freshnessStatusClass(iso)} ${className}`}
      title={iso ?? undefined}
    >
      {formatLastUpdated(iso)}
    </span>
  );
}

export function EventTicketingStatusBadge({
  event,
  clientId,
}: {
  event: PortalEvent;
  clientId?: string;
}) {
  const status = eventTicketingStatus(event);
  return <TicketingStatusPill status={status} clientId={clientId} />;
}

export function VenueTicketingStatusBadge({
  events,
  clientId,
}: {
  events: PortalEvent[];
  clientId?: string;
}) {
  const linked = events.filter((event) => event.ticketing_status.linked_count > 0);
  if (events.length > 1 && linked.length > 0 && linked.length < events.length) {
    return (
      <TicketingStatusPill
        status={{
          kind: "mixed",
          label: `Partially linked (${linked.length} of ${events.length})`,
          tone: "amber",
          ageLabel: null,
          title: "Some events in this venue have connected ticketing providers.",
        }}
        clientId={clientId}
      />
    );
  }

  if (events.length > 0 && linked.length === 0) {
    const allPresale = events.every(isPreSaleEvent);
    return (
      <TicketingStatusPill
        status={{
          kind: allPresale ? "presale" : "not_linked",
          label: allPresale ? "Pre-sale" : "Not linked",
          tone: allPresale ? "muted" : "grey",
          ageLabel: null,
          title: allPresale
            ? "Ticket sales have not opened yet."
            : "No connected ticketing provider for this venue.",
        }}
        clientId={clientId}
      />
    );
  }

  const oldest = oldestFreshness(events);
  return (
    <TicketingStatusPill
      status={freshnessStatus(oldest, "Ticketing data freshness for this venue.")}
      clientId={clientId}
    />
  );
}

export function oldestFreshness(events: PortalEvent[]): string | null {
  return events
    .map((event) => event.freshness_at ?? null)
    .filter((value): value is string => !!value)
    .sort()[0] ?? null;
}

function eventTicketingStatus(event: PortalEvent): DerivedTicketingStatus {
  if (event.ticketing_status.linked_count === 0) {
    if (isPreSaleEvent(event)) {
      return {
        kind: "presale",
        label: "Pre-sale",
        tone: "muted",
        ageLabel: null,
        title: "Ticket sales have not opened yet.",
      };
    }
    return {
      kind: "not_linked",
      label: "Not linked",
      tone: "grey",
      ageLabel: null,
      title: "No connected ticketing provider for this event.",
    };
  }
  return freshnessStatus(
    event.freshness_at ?? null,
    "Ticketing data freshness for this event.",
  );
}

type DerivedTicketingStatus = {
  kind: "live" | "stale" | "very_stale" | "not_linked" | "mixed" | "presale";
  label: string;
  tone: "green" | "amber" | "red" | "grey" | "muted";
  ageLabel: string | null;
  title: string;
};

function freshnessStatus(
  iso: string | null,
  fallbackTitle: string,
): DerivedTicketingStatus {
  if (!iso) {
    return {
      kind: "very_stale",
      label: "Very stale",
      tone: "red",
      ageLabel: "unavailable",
      title: fallbackTitle,
    };
  }
  const ageHours = ageHoursFromIso(iso);
  if (ageHours == null) {
    return {
      kind: "very_stale",
      label: "Very stale",
      tone: "red",
      ageLabel: "unavailable",
      title: fallbackTitle,
    };
  }
  if (ageHours <= 12) {
    return {
      kind: "live",
      label: "Live",
      tone: "green",
      ageLabel: formatAge(iso),
      title: iso,
    };
  }
  if (ageHours < 168) {
    return {
      kind: "stale",
      label: `Stale (${formatAgeShort(ageHours)})`,
      tone: "amber",
      ageLabel: formatAge(iso),
      title: iso,
    };
  }
  return {
    kind: "very_stale",
    label: `Very stale (${formatAgeShort(ageHours)})`,
    tone: "red",
    ageLabel: formatAge(iso),
    title: iso,
  };
}

function TicketingStatusPill({
  status,
  clientId,
}: {
  status: DerivedTicketingStatus;
  clientId?: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1 text-[11px]">
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${pillClass(status.tone)}`}
        title={status.title}
      >
        {status.label}
      </span>
      {status.ageLabel ? (
        <span className="text-muted-foreground">{status.ageLabel}</span>
      ) : null}
      {clientId && (status.kind === "not_linked" || status.kind === "mixed") ? (
        <a
          href={`/clients/${encodeURIComponent(clientId)}/ticketing-link-discovery`}
          className="font-medium text-foreground underline underline-offset-2"
        >
          Link discovery →
        </a>
      ) : null}
    </span>
  );
}

function pillClass(tone: DerivedTicketingStatus["tone"]): string {
  if (tone === "green") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-700";
  if (tone === "red") return "border-red-200 bg-red-50 text-red-700";
  if (tone === "grey") return "border-border bg-muted text-muted-foreground";
  return "border-border bg-background text-muted-foreground";
}

function isPreSaleEvent(event: PortalEvent): boolean {
  if (!event.general_sale_at) return false;
  const ms = Date.parse(event.general_sale_at);
  return Number.isFinite(ms) && ms > Date.now();
}

export function formatLastUpdated(iso: string | null): string {
  if (!iso) return "Last updated unavailable";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Last updated unavailable";
  const now = new Date();
  const today = startOfLocalDay(now).getTime();
  const day = startOfLocalDay(date).getTime();
  const daysAgo = Math.max(0, Math.floor((today - day) / 86_400_000));
  if (daysAgo === 0) return `Last updated ${formatTime(date)}`;
  if (daysAgo === 1) {
    return `Last updated yesterday at ${formatTime(date)}`;
  }
  return `Last updated ${daysAgo} days ago`;
}

function freshnessStatusClass(iso: string | null): string {
  if (!iso) return "text-muted-foreground";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "text-muted-foreground";
  const ageHours = (Date.now() - ms) / 3_600_000;
  if (ageHours < 4) return "text-emerald-600";
  if (ageHours <= 12) return "text-amber-600";
  return "text-red-600";
}

function ageHoursFromIso(iso: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, (Date.now() - ms) / 3_600_000);
}

function formatAge(iso: string): string {
  return formatLastUpdated(iso).replace(/^Last updated /, "");
}

function formatAgeShort(ageHours: number): string {
  if (ageHours < 48) return `${Math.round(ageHours)}h`;
  return `${Math.floor(ageHours / 24)}d`;
}

function formatTime(date: Date): string {
  return TIME.format(date).toUpperCase();
}

function startOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
