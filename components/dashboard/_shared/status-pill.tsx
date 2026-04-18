/**
 * Single status pill for clients and events.
 *
 * Two domains share the same visual token (small rounded badge) but have
 * different palette rules, so we keep one component with a `kind`
 * discriminator rather than two parallel components.
 *
 * Pure render — safe to use from server components.
 */

type Kind = "client" | "event";

const CLIENT_TONE: Record<string, string> = {
  archived: "bg-muted text-muted-foreground",
  paused: "bg-warning/15 text-foreground",
  active: "bg-primary-light text-foreground",
};

const EVENT_TONE: Record<string, string> = {
  sold_out: "bg-success/20 text-foreground",
  cancelled: "bg-destructive/20 text-foreground",
  completed: "bg-muted text-muted-foreground",
  on_sale: "bg-primary-light text-foreground",
};

const NEUTRAL = "bg-muted text-muted-foreground";

function toneFor(kind: Kind, status: string): string {
  if (kind === "client") {
    return CLIENT_TONE[status] ?? CLIENT_TONE.active;
  }
  return EVENT_TONE[status] ?? NEUTRAL;
}

function labelFor(kind: Kind, status: string): string {
  return kind === "event" ? status.replace("_", " ") : status;
}

export function StatusPill({
  status,
  kind,
}: {
  status: string;
  kind: Kind;
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${toneFor(
        kind,
        status,
      )}`}
    >
      {labelFor(kind, status)}
    </span>
  );
}
