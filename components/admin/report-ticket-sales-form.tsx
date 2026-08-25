"use client";

import { useActionState, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  INITIAL_REPORT_TICKET_SALES_STATE,
  reportClientTicketSales,
} from "@/lib/actions/client-ticket-sales";
import { funnelCostLabel, isAmountCell } from "@/lib/dashboard/event-funnel";
import type { ClientSalesEventRow } from "@/lib/admin/client-ticket-sales";
import { AdminButton } from "./ui/button";

function formatDate(isoDay: string | null): string | null {
  if (!isoDay) return null;
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDay;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatCost(cell: ClientSalesEventRow["costPerTicket"]): string {
  if (isAmountCell(cell)) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 2,
    }).format(cell.value);
  }
  return funnelCostLabel(cell);
}

export function ReportTicketSalesForm({
  clientSlug,
  event,
}: {
  clientSlug: string;
  event: ClientSalesEventRow;
}) {
  const [state, formAction, pending] = useActionState(
    reportClientTicketSales,
    INITIAL_REPORT_TICKET_SALES_STATE,
  );
  const [draft, setDraft] = useState(
    event.previousTotal != null ? String(event.previousTotal) : "",
  );

  const draftNumber = Number(draft);
  const needsConfirm =
    event.previousTotal != null &&
    Number.isFinite(draftNumber) &&
    draftNumber < event.previousTotal;

  const isThisEvent = state.eventId === event.eventId;
  const purchases = isThisEvent && state.purchases != null
    ? state.purchases
    : event.purchases;
  const costLabel =
    isThisEvent && state.costPerTicketLabel
      ? state.costPerTicketLabel
      : formatCost(event.costPerTicket);
  const previousLabel = useMemo(() => {
    if (event.previousTotal == null) return "No figure reported yet.";
    const when = formatDate(event.previousDate);
    return when
      ? `${event.previousTotal.toLocaleString("en-GB")} as of ${when}`
      : event.previousTotal.toLocaleString("en-GB");
  }, [event.previousDate, event.previousTotal]);

  return (
    <article className="border-b-[0.5px] border-black py-8 last:border-b-0">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="admin-heading text-[20px] leading-none">{event.name}</h2>
          <p className="mt-2 font-[family-name:var(--admin-mono)] text-[11px] uppercase tracking-[1px] text-[#666]">
            {[event.eventCode, formatDate(event.eventDate)]
              .filter(Boolean)
              .join(" · ") || "Date TBC"}
          </p>
        </div>
        <div className="flex gap-8">
          <div>
            <p className="font-[family-name:var(--admin-mono)] text-[10px] uppercase tracking-[1.5px] text-[#666]">
              Purchases
            </p>
            <p className="admin-heading mt-1 text-[24px] leading-none">
              {purchases.toLocaleString("en-GB")}
            </p>
          </div>
          <div>
            <p className="font-[family-name:var(--admin-mono)] text-[10px] uppercase tracking-[1.5px] text-[#666]">
              Cost per ticket
            </p>
            <p className="admin-heading mt-1 text-[24px] leading-none">
              {costLabel}
            </p>
          </div>
        </div>
      </div>

      <p className="mt-4 font-[family-name:var(--admin-mono)] text-[12px] text-[#666]">
        Last reported: {previousLabel}
      </p>

      <form action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name="client_slug" value={clientSlug} />
        <input type="hidden" name="event_id" value={event.eventId} />
        <label className="block">
          <span className="font-[family-name:var(--admin-mono)] text-[11px] uppercase tracking-[1px] text-black">
            Total tickets sold to date
          </span>
          <input
            type="number"
            name="tickets_sold"
            min={0}
            step={1}
            required
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="mt-2 block w-full max-w-xs border-[0.5px] border-black bg-white px-3 py-2 font-[family-name:var(--admin-mono)] text-[14px] tabular-nums"
          />
        </label>

        {needsConfirm && (
          <label className="flex items-start gap-3 font-[family-name:var(--admin-mono)] text-[12px] leading-relaxed text-black">
            <input
              type="checkbox"
              name="confirm_decrease"
              className="mt-0.5"
            />
            <span>
              This is lower than the last figure. I am correcting the
              running total — not entering today&apos;s extra sales.
            </span>
          </label>
        )}

        {isThisEvent && state.status === "error" && state.message && (
          <p className="font-[family-name:var(--admin-mono)] text-[12px] text-[#d33]">
            {state.message}
          </p>
        )}
        {isThisEvent && state.status === "saved" && state.message && (
          <p className="font-[family-name:var(--admin-mono)] text-[12px] text-black">
            {state.message}
          </p>
        )}

        <AdminButton type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving
            </>
          ) : (
            "Save total"
          )}
        </AdminButton>
      </form>
    </article>
  );
}
