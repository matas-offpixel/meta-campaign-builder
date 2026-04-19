/**
 * Single status pill for clients, events, and campaign drafts.
 *
 * Each domain shares the same visual token (small rounded badge) but has
 * its own palette rules, so we keep one component with a `kind`
 * discriminator rather than three parallel components.
 *
 * Pure render — safe to use from server components.
 */

type Kind = "client" | "event" | "draft" | "plan";

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

// Draft palette: draft = neutral muted (work in progress), published =
// success (matches event sold_out), archived = same muted as client.archived
// for consistency. Labels carry the meaningful distinction between draft
// and archived; tone differentiates draft → published as the only
// "state changed for the better" signal.
const DRAFT_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-success/20 text-foreground",
  archived: "bg-muted text-muted-foreground",
};

// Plan palette: draft = muted (in progress), live = primary-light (active
// pacing), completed = muted (settled / past tense), archived = muted (out
// of sight). Mirrors the client/event tonal logic — only the "active right
// now" state gets the primary tint.
const PLAN_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  live: "bg-primary-light text-foreground",
  completed: "bg-muted text-muted-foreground",
  archived: "bg-muted text-muted-foreground",
};

const NEUTRAL = "bg-muted text-muted-foreground";

function toneFor(kind: Kind, status: string): string {
  if (kind === "client") return CLIENT_TONE[status] ?? CLIENT_TONE.active;
  if (kind === "draft") return DRAFT_TONE[status] ?? NEUTRAL;
  if (kind === "plan") return PLAN_TONE[status] ?? NEUTRAL;
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
