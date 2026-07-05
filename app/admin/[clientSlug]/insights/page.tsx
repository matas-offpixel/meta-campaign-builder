import Link from "next/link";

import {
  CountryBars,
  DailyBarChart,
  SocialDonut,
} from "@/components/admin/insight-charts";
import { requireClientContext } from "@/lib/auth/get-client-context";
import {
  buildCountryBreakdown,
  buildDailySeries,
  buildSocialSplit,
  computeMetrics,
} from "@/lib/admin/insights";
import { getPixelHealth, listInsightRows } from "@/lib/db/client-admin";
import { getFanFilterOptions } from "@/lib/db/fan-signups";

/**
 * app/admin/[clientSlug]/insights/page.tsx — signup analytics (OP909
 * Phase 6). Client-wide by default; ?event={id} scopes every panel to
 * one landing page (the dropdown is a GET form, same pattern as /fans).
 * Aggregation is in-memory over non-PII rows — no rollup table until
 * scale demands one.
 */
export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);

  const rawEvent = (await searchParams).event;
  const eventParam = Array.isArray(rawEvent) ? rawEvent[0] : rawEvent;
  const eventId =
    eventParam &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      eventParam,
    )
      ? eventParam
      : null;

  const [rows, options, pixel] = await Promise.all([
    listInsightRows(membership.clientId, eventId),
    getFanFilterOptions(membership.clientId),
    getPixelHealth(membership.clientId),
  ]);

  const now = new Date();
  const metrics = computeMetrics(rows, now);
  const series = buildDailySeries(rows, now, 30);
  const countries = buildCountryBreakdown(rows, 10);
  const social = buildSocialSplit(rows);
  const scopedEvent = eventId
    ? options.events.find((e) => e.eventId === eventId)
    : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl tracking-wide">Insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {scopedEvent
              ? `Signup analytics for ${scopedEvent.eventName}.`
              : "Signup analytics across all your landing pages."}
          </p>
        </div>
        <form method="get" className="flex items-center gap-2">
          <select
            name="event"
            defaultValue={eventId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">All pages</option>
            {options.events.map((event) => (
              <option key={event.eventId} value={event.eventId}>
                {event.eventName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
          >
            Apply
          </button>
        </form>
      </div>

      {/* ── Metric cards ─────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Total signups"
          value={metrics.total.toLocaleString("en-GB")}
        />
        <MetricCard
          label="Today"
          value={metrics.today.toLocaleString("en-GB")}
        />
        <MetricCard
          label="Last 7 days"
          value={metrics.last7Days.toLocaleString("en-GB")}
        />
        <MetricCard
          label="WhatsApp opt-in rate"
          value={
            metrics.waOptInRatePct === null
              ? "—"
              : `${metrics.waOptInRatePct}%`
          }
          hint="Share of fans who ticked the WhatsApp opt-in"
        />
      </div>

      {/* ── Daily timeline ───────────────────────────────────────────── */}
      <section className="mt-6 rounded-md border border-border bg-card p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Daily signups — last 30 days
        </h2>
        <div className="mt-4">
          {metrics.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              No signups yet — the timeline fills in as fans register.
            </p>
          ) : (
            <DailyBarChart series={series} />
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* ── Country breakdown ──────────────────────────────────────── */}
        <section className="rounded-md border border-border bg-card p-5">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Countries
          </h2>
          <div className="mt-4">
            <CountryBars slices={countries} />
          </div>
        </section>

        {/* ── Social split ───────────────────────────────────────────── */}
        <section className="rounded-md border border-border bg-card p-5">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Instagram vs TikTok
          </h2>
          <div className="mt-4">
            <SocialDonut split={social} />
          </div>
        </section>
      </div>

      {/* ── Meta Pixel health ────────────────────────────────────────── */}
      <section className="mt-6 rounded-md border border-border bg-card p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Meta Pixel
        </h2>
        {pixel === null || pixel.pixelId === null ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No Meta Pixel configured — signups aren&apos;t being sent to Meta
            for ad optimisation. Set one up under{" "}
            <Link
              href={`/admin/${membership.clientSlug}/integrations`}
              className="underline hover:text-foreground"
            >
              Integrations
            </Link>
            .
          </p>
        ) : (
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Pixel ID</dt>
              <dd className="mt-1 font-medium tabular-nums">{pixel.pixelId}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Conversions API
              </dt>
              <dd className="mt-1">
                {pixel.capiTokenConfigured ? (
                  <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    configured
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    not configured
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Mode</dt>
              <dd className="mt-1 font-medium">
                {pixel.testEventCode ? (
                  <>
                    test{" "}
                    <span className="text-xs text-muted-foreground">
                      ({pixel.testEventCode})
                    </span>
                  </>
                ) : (
                  "live"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last verified</dt>
              <dd className="mt-1 font-medium">
                {pixel.verifiedAt ? formatVerified(pixel.verifiedAt) : "never"}
              </dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}

function formatVerified(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(date);
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
