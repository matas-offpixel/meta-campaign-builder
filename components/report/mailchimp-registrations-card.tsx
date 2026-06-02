/**
 * components/report/mailchimp-registrations-card.tsx
 *
 * Renders on brand-awareness share reports when the event has a resolved
 * Mailchimp audience and at least one snapshot row.
 *
 * Three metrics:
 *   Total Subscribers   — latest email_subscribers
 *   Daily Growth        — delta between two most-recent snapshots ("vs yesterday")
 *   Cost / Registration — total_cross_platform_spend / total_subscribers (GBP, 2dp)
 *
 * Visual style matches the brand-awareness metrics row pattern in this
 * codebase (compact stat cells with an uppercase tracking label).
 *
 * Server component — receives pre-fetched data props; no client fetch.
 */

import { computeDailyGrowth } from "@/lib/mailchimp/daily-growth";

export interface MailchimpAudienceSnapshotSummary {
  email_subscribers: number | null;
  snapshot_at: string;
}

export interface MailchimpRegistrationsCardProps {
  /** Snapshots ordered oldest → newest. Must have at least one entry. */
  snapshots: MailchimpAudienceSnapshotSummary[];
  /**
   * Total cross-platform spend in GBP, used for Cost per Registration.
   * null or 0 → "—" for the CPR cell.
   */
  totalSpendGbp: number | null;
  /** Audience id shown in the subtitle. */
  audienceId: string;
}

function fmtGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-GB").format(Math.round(n));
}

export function MailchimpRegistrationsCard({
  snapshots,
  totalSpendGbp,
  audienceId,
}: MailchimpRegistrationsCardProps) {
  if (snapshots.length === 0) return null;

  const latest = snapshots.at(-1)!;
  const first = snapshots[0]!;

  const totalSubscribers = latest.email_subscribers ?? null;

  // Daily growth: delta between the two most-recent snapshots (today vs yesterday).
  const { dailyNew, compareToDate } = computeDailyGrowth(snapshots);

  const dailyNewDisplay =
    dailyNew != null
      ? dailyNew >= 0
        ? `+${fmtInt(dailyNew)}`
        : fmtInt(dailyNew)
      : "—";

  // CPR uses total subscriber base, not just daily new.
  const costPerRegistration: string =
    totalSubscribers != null &&
    totalSubscribers > 0 &&
    totalSpendGbp != null &&
    totalSpendGbp > 0
      ? fmtGbp(totalSpendGbp / totalSubscribers)
      : "—";

  return (
    <section className="rounded-md border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Email Registrations
          </p>
          <h2 className="mt-0.5 font-heading text-base tracking-wide text-foreground">
            Mailchimp Audience
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Audience{" "}
            <span className="font-mono text-[11px]">{audienceId}</span>
            {" · since "}
            {formatDate(first.snapshot_at)}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-[#FFE01B]/40 bg-[#FFE01B]/10 px-2 py-0.5 text-[10px] font-medium text-foreground/80">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "#FFE01B" }}
          />
          Mailchimp
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 border-t border-border pt-4">
        <RegistrationMetric
          label="Total Subscribers"
          value={totalSubscribers != null ? fmtInt(totalSubscribers) : "—"}
          sub={`As of ${formatDate(latest.snapshot_at)}`}
        />
        <RegistrationMetric
          label="New Subscribers"
          value={dailyNewDisplay}
          sub={
            compareToDate != null
              ? `vs ${formatDate(compareToDate)}`
              : snapshots.length < 2
                ? "Awaiting second snapshot"
                : "—"
          }
          highlight={dailyNew != null && dailyNew > 0}
        />
        <RegistrationMetric
          label="Cost / Registration"
          value={costPerRegistration}
          sub={costPerRegistration !== "—" ? "Total subscribers basis" : "Awaiting data"}
        />
      </div>
    </section>
  );
}

function RegistrationMetric({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-heading text-xl tracking-wide ${
          highlight ? "text-emerald-600" : "text-foreground"
        }`}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
