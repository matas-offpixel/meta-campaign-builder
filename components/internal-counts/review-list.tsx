/**
 * The Internal Counts review list (D8, HD1). Internal only (D11).
 *
 * What it shows: the connected inbox, the "Upload count PDF" backstop, every
 * open review item grouped by the email it came from, and the recent
 * counts. Plain forms posting to route handlers, no client JS, so the
 * page and its frames (IC1, IC2) render the same view from props.
 */

import type { InternalCountsView, RecentCountView, ReviewGroupView, ReviewItemView } from "@/lib/internal-counts/view-types";

export type { InternalCountsView, RecentCountView, ReviewGroupView, ReviewItemView };

const LONDON = "Europe/London";

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: LONDON });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: LONDON });
  return `${day}, ${time}`;
}

export function formatDay(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: LONDON });
}

function GmailLine({ view }: { view: InternalCountsView }) {
  if (!view.gmailConfigured) {
    return <p className="text-sm text-muted-foreground">Gmail connect isn&apos;t set up on this deployment. Upload a count PDF instead.</p>;
  }
  if (!view.gmail) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">Gmail isn&apos;t connected, so counts aren&apos;t read automatically.</p>
        <a href="/api/gmail/oauth/start" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
          Connect Gmail
        </a>
      </div>
    );
  }
  const { email, lastPullAt, lastPullError } = view.gmail;
  return (
    <div className="space-y-1">
      <p className="text-sm">
        Reading <span className="font-medium">{email}</span>
        {lastPullAt ? <span className="text-muted-foreground"> · last read {formatWhen(lastPullAt)}</span> : null}
      </p>
      {lastPullError ? <p className="text-sm text-destructive">The last read failed: {lastPullError}</p> : null}
    </div>
  );
}

function UploadForm() {
  return (
    <form action="/api/internal-counts/upload" method="post" encType="multipart/form-data" className="flex flex-wrap items-center gap-3">
      <label className="text-sm font-medium" htmlFor="count-pdf">
        Upload count PDF
      </label>
      <input id="count-pdf" name="file" type="file" accept="application/pdf" required className="max-w-full text-sm" />
      <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
        Upload
      </button>
    </form>
  );
}

function ItemRow({ item }: { item: ReviewItemView }) {
  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[160px_minmax(0,1fr)_120px]" data-kind={item.kind}>
      <p className="text-sm font-medium">{item.showName ?? "Whole email"}</p>
      <p className="text-sm">{item.message}</p>
      <p className={`text-xs sm:text-right ${item.blocking ? "text-destructive" : "text-muted-foreground"}`}>
        {item.blocking ? "Not written" : "Written, with a note"}
      </p>
    </li>
  );
}

function ReviewGroup({ group }: { group: ReviewGroupView }) {
  const blocking = group.items.some((i) => i.blocking);
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{group.subject}</p>
          <p className="text-xs text-muted-foreground">Received {formatWhen(group.receivedAt)}</p>
        </div>
        {blocking ? (
          <form action={`/api/internal-counts/reports/${group.reportId}/rerun`} method="post">
            <button type="submit" className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted">
              Run again
            </button>
          </form>
        ) : null}
      </div>
      <ul className="mt-2 divide-y divide-border">
        {group.items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

function RecentCounts({ recent }: { recent: RecentCountView[] }) {
  if (recent.length === 0) return <p className="text-sm text-muted-foreground">No counts read yet.</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-card">
      {recent.map((r) => (
        <li key={r.reportId} className="grid grid-cols-1 gap-x-4 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_110px_170px]">
          <p className="truncate text-sm">{r.subject}</p>
          <p className="text-sm text-muted-foreground">{r.countDate ? `Count ${formatDay(r.countDate)}` : "No count date"}</p>
          <p className="text-sm text-muted-foreground sm:text-right">
            {r.written} written{r.inReview ? ` · ${r.inReview} to review` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function InternalCountsReviewView({ view }: { view: InternalCountsView }) {
  const open = view.groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="space-y-3">
        <h1 className="text-xl font-semibold">Internal Counts</h1>
        <GmailLine view={view} />
        <UploadForm />
        {view.flash ? <p className="text-sm text-muted-foreground" role="status">{view.flash}</p> : null}
      </header>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">To review{open ? ` · ${open}` : ""}</h2>
        {view.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to review.</p>
        ) : (
          view.groups.map((g) => <ReviewGroup key={g.reportId} group={g} />)
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Recent counts</h2>
        <RecentCounts recent={view.recent} />
      </section>
    </div>
  );
}
