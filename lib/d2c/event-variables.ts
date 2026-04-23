/**
 * Resolves known {{variable}} tokens for D2C templates from an event row.
 * Safe to import from client components (no server-only).
 */

export const KNOWN_EVENT_VARIABLE_KEYS = [
  "event_name",
  "event_date_long",
  "event_date_short",
  "ticket_url",
  "presale_start_at_local",
  "general_sale_at_local",
  "venue_name",
  "city",
  "artist_headliners",
  "days_to_show",
  "days_to_presale",
] as const;

export type KnownEventVariableKey = (typeof KNOWN_EVENT_VARIABLE_KEYS)[number];

export interface EventVariablesSource {
  name: string;
  event_date: string | null;
  event_start_at: string | null;
  event_timezone: string | null;
  ticket_url: string | null;
  presale_at: string | null;
  general_sale_at: string | null;
  venue_name: string | null;
  venue_city: string | null;
}

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function diffCalendarDaysUtc(from: Date, to: Date): number {
  const a = startOfDayUtc(from).getTime();
  const b = startOfDayUtc(to).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function formatInTimeZone(iso: string | null, tz: string | null, long: boolean): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz && tz.trim() ? tz : undefined,
      dateStyle: long ? "full" : "medium",
      timeStyle: long ? "short" : undefined,
    }).format(d);
  } catch {
    return "";
  }
}

function formatDateShort(iso: string | null, tz: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz && tz.trim() ? tz : undefined,
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return "";
  }
}

/**
 * When presale / on-sale timestamps are missing, we treat the event as
 * already on public sale — presale countdown copy should not block sends.
 */
export function resolveEventVariables(
  event: EventVariablesSource,
  options?: {
    artistHeadliners?: string[];
    now?: Date;
  },
): Record<KnownEventVariableKey, string> {
  const now = options?.now ?? new Date();
  const tz = event.event_timezone;
  const primaryDateIso = event.event_start_at ?? event.event_date;
  const eventStart = primaryDateIso ? new Date(primaryDateIso) : null;

  const headliners =
    options?.artistHeadliners?.filter(Boolean).join(", ") ?? "";

  let daysToShow = "";
  if (eventStart && !Number.isNaN(eventStart.getTime())) {
    daysToShow = String(Math.max(0, diffCalendarDaysUtc(now, eventStart)));
  }

  const hasPresalePhase =
    event.presale_at != null &&
    String(event.presale_at).trim() !== "" &&
    event.general_sale_at != null &&
    String(event.general_sale_at).trim() !== "";

  let daysToPresale = "";
  if (hasPresalePhase && event.presale_at) {
    const presaleStart = new Date(event.presale_at);
    if (!Number.isNaN(presaleStart.getTime())) {
      daysToPresale = String(Math.max(0, diffCalendarDaysUtc(now, presaleStart)));
    }
  } else {
    daysToPresale = "0";
  }

  return {
    event_name: event.name ?? "",
    event_date_long: formatInTimeZone(primaryDateIso, tz, true),
    event_date_short: formatDateShort(primaryDateIso, tz),
    ticket_url: event.ticket_url ?? "",
    presale_start_at_local: formatInTimeZone(event.presale_at, tz, true),
    general_sale_at_local: formatInTimeZone(event.general_sale_at, tz, true),
    venue_name: event.venue_name ?? "",
    city: event.venue_city ?? "",
    artist_headliners: headliners,
    days_to_show: daysToShow,
    days_to_presale: daysToPresale,
  };
}

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function extractTemplateVariableKeys(markdown: string): string[] {
  const keys = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(VAR_RE);
  while ((m = re.exec(markdown)) !== null) {
    keys.add(m[1]);
  }
  return [...keys].sort();
}

export function substituteTemplateVariables(
  markdown: string,
  values: Record<string, string>,
): string {
  return markdown.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const v = values[key];
    return v !== undefined ? v : `{{${key}}}`;
  });
}

export function markdownToBasicHtml(markdown: string): string {
  const paragraphs = markdown.split(/\n{2,}/);
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const inlineFormat = (line: string): string => {
    let s = escape(line);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
    return s;
  };

  const blocks = paragraphs.map((p) => {
    const lines = p.split("\n").map((line) => inlineFormat(line.trimEnd()));
    const inner = lines.join("<br />\n");
    return `<p>${inner}</p>`;
  });
  return blocks.join("\n");
}
