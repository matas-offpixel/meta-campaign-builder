import { resolveEventVariables } from "@/lib/d2c/event-variables";
import { buildTimelineBars } from "@/lib/d2c/dashboard-view";
import { isCountOk, type CountResult, type EventSignupStats } from "@/lib/d2c/stats";
import type { D2CScheduledSend } from "@/lib/d2c/types";
import type { D2CEventDashboardData } from "@/lib/db/d2c-dashboard";
import { SendPreview } from "./send-preview";
import { SendActions } from "./send-actions";
import { TimelineStrip } from "./timeline-strip";
import { SharePanel } from "./share-panel";

/**
 * components/dashboard/d2c/event-dashboard.tsx
 *
 * The shared D2C event dashboard body. Rendered in two modes:
 *   - operator (readOnly=false): approver actions + share panel.
 *   - public share (readOnly=true): identical view, no controls, no PII.
 */

export interface EventDashboardProps {
  data: D2CEventDashboardData;
  stats: EventSignupStats | null;
  readOnly: boolean;
  canApprove: boolean;
  /** Operator-only share state (ignored when readOnly). */
  share?: { url: string | null; id: string | null };
}

function formatEventDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(d);
}

function StatCard({
  label,
  result,
  asOfLabel,
}: {
  label: string;
  result: CountResult | { count: number; asOf: string } | null;
  asOfLabel?: boolean;
}) {
  let value: string;
  let sub: string | null = null;
  if (!result) {
    value = "—";
  } else if (isCountOk(result)) {
    value = result.count.toLocaleString();
    if (asOfLabel) {
      const d = new Date(result.asOf);
      sub = Number.isNaN(d.getTime())
        ? null
        : `as of ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(d)}`;
    }
  } else {
    value = "—";
    sub = result.error;
  }
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function EventDashboard({
  data,
  stats,
  readOnly,
  canApprove,
  share,
}: EventDashboardProps) {
  const { event, copy, sends, templates, copyBundle } = data;
  const clientName = event.client?.name ?? "—";
  const eventDate = formatEventDate(event.event_start_at ?? event.event_date);
  const venue = [event.venue_name, event.venue_city].filter(Boolean).join(", ");

  const base = resolveEventVariables({
    name: event.name,
    event_date: event.event_date,
    event_start_at: event.event_start_at,
    event_timezone: event.event_timezone,
    ticket_url: event.ticket_url,
    presale_at: event.presale_at,
    general_sale_at: event.general_sale_at,
    venue_name: event.venue_name,
    venue_city: event.venue_city,
  });

  function varsFor(send: D2CScheduledSend): Record<string, string> {
    const v: Record<string, string> = { ...base };
    if (copy?.whatsapp_community_url) v.community_url = copy.whatsapp_community_url;
    for (const [k, val] of Object.entries(send.variables ?? {})) {
      v[k] = val == null ? "" : String(val);
    }
    return v;
  }

  const bars = buildTimelineBars(sends);
  const showLp = Boolean(stats?.landing_page && stats.landing_page.count > 0);

  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{event.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {clientName}
            {eventDate ? ` · ${eventDate}` : ""}
            {venue ? ` · ${venue}` : ""}
          </p>
          {event.status && (
            <span className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {event.status}
            </span>
          )}
        </div>
        {!readOnly && share && (
          <div className="w-full max-w-sm">
            <SharePanel
              eventId={event.id}
              initialShareUrl={share.url}
              initialShareId={share.id}
            />
          </div>
        )}
      </header>

      {/* ── Stats band ─────────────────────────────────────────── */}
      <section className={`grid grid-cols-2 gap-3 ${showLp ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <StatCard
          label="Total signups"
          result={
            stats ? { count: stats.total_unique_estimate, asOf: new Date().toISOString() } : null
          }
        />
        <StatCard label="Mailchimp members" result={stats?.mailchimp ?? null} asOfLabel />
        <StatCard label="Bird contacts" result={stats?.bird ?? null} asOfLabel />
        {showLp && (
          <StatCard label="Landing-page signups" result={stats?.landing_page ?? null} />
        )}
      </section>

      {/* ── Timeline ───────────────────────────────────────────── */}
      {bars.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Timeline</h2>
          <TimelineStrip bars={bars} />
        </section>
      )}

      {/* ── Send previews ──────────────────────────────────────── */}
      <section className="space-y-8">
        <h2 className="text-sm font-semibold text-foreground">
          Scheduled sends ({sends.length})
        </h2>
        {sends.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scheduled sends yet.</p>
        ) : (
          sends.map((send) => (
            <div key={send.id} id={`send-${send.id}`} className="scroll-mt-24">
              <SendPreview
                send={send}
                template={templates[send.template_id]}
                copyBlock={send.job_type ? copyBundle[send.job_type] ?? null : null}
                artworkUrl={copy?.artwork_url ?? null}
                eventName={event.name}
                communityUrl={copy?.whatsapp_community_url ?? null}
                variables={varsFor(send)}
                actions={
                  !readOnly && canApprove ? (
                    <SendActions send={send} eventId={event.id} />
                  ) : undefined
                }
              />
            </div>
          ))
        )}
      </section>
    </div>
  );
}
