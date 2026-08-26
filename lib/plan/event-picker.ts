export interface PlanEventOption {
  id: string;
  name: string;
  clientId?: string | null;
  clientName?: string | null;
  venueName?: string | null;
  eventDate?: string | null;
  eventCode?: string | null;
  kind?: string | null;
  metaAdAccountId?: string | null;
  googleCustomerId?: string | null;
}

export interface PlanEventPickerRow {
  id: string;
  label: string;
  sublabel: string;
  keywords: string;
}

export type PlanEventBucket = "upcoming" | "undated" | "past";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function todayIsoDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatPlanEventDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [year, month, day] = iso.slice(0, 10).split("-");
  const monthIndex = Number(month) - 1;
  if (!year || monthIndex < 0 || monthIndex > 11 || !day) return iso.slice(0, 10);
  return `${Number(day)} ${MONTHS[monthIndex]} ${year}`;
}

export function planEventVenue(event: PlanEventOption): string | null {
  const name = event.venueName?.trim() || "";
  return name || null;
}

export function classifyPlanEvent(
  event: PlanEventOption,
  today: string,
): PlanEventBucket {
  const date = event.eventDate?.slice(0, 10) || "";
  if (!date) return "undated";
  return date >= today ? "upcoming" : "past";
}

export function sortPlanEvents(
  events: PlanEventOption[],
  today: string,
): PlanEventOption[] {
  const rank: Record<PlanEventBucket, number> = {
    upcoming: 0,
    undated: 1,
    past: 2,
  };
  return [...events].sort((a, b) => {
    const bucketA = classifyPlanEvent(a, today);
    const bucketB = classifyPlanEvent(b, today);
    if (rank[bucketA] !== rank[bucketB]) return rank[bucketA] - rank[bucketB];
    const dateA = a.eventDate?.slice(0, 10) || "";
    const dateB = b.eventDate?.slice(0, 10) || "";
    if (bucketA === "upcoming") return dateA.localeCompare(dateB);
    if (bucketA === "past") return dateB.localeCompare(dateA);
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

export function visiblePlanEvents(
  events: PlanEventOption[],
  input: { today: string; showPast: boolean; selectedId?: string | null },
): PlanEventOption[] {
  return sortPlanEvents(events, input.today).filter((event) => {
    if (classifyPlanEvent(event, input.today) !== "past") return true;
    if (input.showPast) return true;
    return !!input.selectedId && event.id === input.selectedId;
  });
}

export function defaultPlanEventId(
  events: PlanEventOption[],
  input: { today: string; preferredId?: string | null },
): string {
  if (input.preferredId && events.some((event) => event.id === input.preferredId)) {
    return input.preferredId;
  }
  return visiblePlanEvents(events, { today: input.today, showPast: false })[0]?.id ?? "";
}

function secondaryParts(event: PlanEventOption): string[] {
  return [
    event.clientName?.trim() || "",
    planEventVenue(event) || "",
    formatPlanEventDate(event.eventDate) || "",
  ].filter(Boolean);
}

function shortEventId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

/**
 * Primary = event name. Secondary = client · venue · date.
 * Colliding rows append event_code, then a short id, so two events
 * never render the same label pair.
 */
export function planEventPickerRows(events: PlanEventOption[]): PlanEventPickerRow[] {
  const drafts = events.map((event) => {
    const label = event.name.trim() || "Untitled event";
    const sublabel = secondaryParts(event).join(" · ");
    return {
      event,
      label,
      sublabel,
      key: `${label}\n${sublabel}`,
    };
  });

  const counts = new Map<string, number>();
  for (const draft of drafts) {
    counts.set(draft.key, (counts.get(draft.key) ?? 0) + 1);
  }

  const used = new Map<string, number>();
  return drafts.map(({ event, label, sublabel, key }) => {
    let resolved = sublabel;
    if ((counts.get(key) ?? 0) > 1) {
      const suffix = event.eventCode?.trim() || shortEventId(event.id);
      resolved = [sublabel, suffix].filter(Boolean).join(" · ");
      const uniqueKey = `${label}\n${resolved}`;
      const seen = used.get(uniqueKey) ?? 0;
      used.set(uniqueKey, seen + 1);
      if (seen > 0) {
        resolved = [resolved, shortEventId(event.id)].filter(Boolean).join(" · ");
      }
    }
    return {
      id: event.id,
      label,
      sublabel: resolved,
      keywords: [event.eventCode, event.kind, event.clientName, event.venueName]
        .filter((part): part is string => !!part && part.trim().length > 0)
        .join(" "),
    };
  });
}

export function renderedPlanEventKey(row: PlanEventPickerRow): string {
  return `${row.label}\n${row.sublabel}`;
}
