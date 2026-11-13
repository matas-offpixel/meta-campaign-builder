/**
 * The Internal Counts review list (M5, R1 of
 * docs/design-record/2026-11-13-internal-counts-matching.html). Internal
 * only (D11): never on a share link or under /admin.
 *
 * "To check · {n}" or "Nothing to check", each item with the email's
 * subject, sender and received time, and a "Checked" section with who and
 * when. R1's 1280 and 393 wordings both render; the viewport picks one.
 * Plain forms posting to route handlers, no client JS, so the page and the
 * frames render the same view from props.
 */

import type {
  ActionView,
  CheckedItemView,
  EventOption,
  InternalCountsView,
  ReviewItemView,
  SourceView,
} from "@/lib/internal-counts/view-types";

import { UploadCountPdfButton } from "./upload-button";

export type { InternalCountsView };

const BUTTON = "rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted";
/** The manual-entry select and field look like the buttons beside them (R1a), not like page-filled inputs. */
const CONTROL = "rounded-md border border-border bg-transparent px-3 py-1.5 text-xs font-medium";

function Source({ source }: { source: SourceView }) {
  const label = source.subject === null ? source.received : `"${source.subject}"`;
  const linked = source.emailUrl ? (
    <a href={source.emailUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
      {label}
    </a>
  ) : (
    label
  );
  if (source.subject === null) return <p className="text-xs text-muted-foreground">{linked}</p>;
  return (
    <p className="text-xs text-muted-foreground">
      {linked}
      {source.sender ? ` · ${source.sender}` : ""} · {source.received}
    </p>
  );
}

function Action({ itemId, action, events }: { itemId: string; action: ActionView; events: EventOption[] }) {
  if (!action.action) {
    return (
      <a href={action.href} target="_blank" rel="noreferrer" className={BUTTON}>
        {action.label}
      </a>
    );
  }
  const needs = action.needs ?? [];
  return (
    <form action={`/api/internal-counts/items/${itemId}`} method="post" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="action" value={action.action} />
      {Object.entries(action.fields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {needs.includes("event") ? (
        <select name="event_id" required aria-label="Event" className={`max-w-[16rem] ${CONTROL}`}>
          <option value="">Event…</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      ) : null}
      {needs.includes("figure") ? (
        <input
          name="figure"
          type="number"
          min={0}
          step={1}
          required
          aria-label="Tickets"
          placeholder="Tickets"
          className={`w-24 ${CONTROL}`}
        />
      ) : null}
      <button type="submit" className={BUTTON}>
        {action.label}
      </button>
    </form>
  );
}

function OpenItem({ item, events }: { item: ReviewItemView; events: EventOption[] }) {
  return (
    <li className="space-y-1.5 py-3" data-kind={item.kind}>
      <p className="text-sm font-medium">
        <span className="hidden sm:inline">{item.title}</span>
        <span className="sm:hidden">{item.titleShort}</span>
      </p>
      <p className="text-sm">
        <span className="hidden sm:inline">{item.body}</span>
        <span className="sm:hidden">{item.bodyShort}</span>
      </p>
      <Source source={item.source} />
      <div className="flex flex-wrap gap-2 pt-1">
        {item.actions.map((a) => (
          <Action key={`${a.action}-${a.label}`} itemId={item.id} action={a} events={events} />
        ))}
      </div>
    </li>
  );
}

function CheckedItem({ item, events }: { item: CheckedItemView; events: EventOption[] }) {
  return (
    <li className="space-y-1 py-2.5">
      <p className="text-sm text-muted-foreground">{item.title}</p>
      <p className="text-xs text-muted-foreground">
        {item.source.subject === null ? "" : `"${item.source.subject}" · `}
        {item.source.received} · {item.by}
      </p>
      {item.undo ? (
        <div className="pt-1">
          <Action itemId={item.id} action={item.undo} events={events} />
        </div>
      ) : null}
    </li>
  );
}

export function InternalCountsReviewView({ view }: { view: InternalCountsView }) {
  const n = view.open.length;
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-lg font-semibold">{n ? `To check · ${n}` : "Nothing to check"}</h1>
          <UploadCountPdfButton className={BUTTON} />
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {view.statusLine}
        </p>
        {view.flash ? (
          <p className="text-sm" role="status">
            {view.flash}
          </p>
        ) : null}
      </header>
      {n ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-card px-4">
          {view.open.map((item) => (
            <OpenItem key={item.id} item={item} events={view.events} />
          ))}
        </ul>
      ) : null}
      {view.checked.length ? (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Checked</h2>
          <ul className="divide-y divide-border">
            {view.checked.map((item) => (
              <CheckedItem key={item.id} item={item} events={view.events} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
