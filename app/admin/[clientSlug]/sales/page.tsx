import { requireClientContext } from "@/lib/auth/get-client-context";
import { listClientEventsForSales } from "@/lib/db/client-ticket-sales-load";
import { ReportTicketSalesForm } from "@/components/admin/report-ticket-sales-form";

/**
 * Client-entered cumulative ticket totals (roadmap v2 Phase A.3).
 * Most outlets have no API; the client types the running total here
 * and the funnel purchases / cost-per-ticket recompute on save.
 */
export default async function ClientSalesPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);
  const events = await listClientEventsForSales(membership.clientId);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h1 className="admin-heading text-[28px] leading-none">
        Report ticket sales
      </h1>
      <p className="mt-3 max-w-2xl font-[family-name:var(--admin-mono)] text-[12px] leading-relaxed text-[#666]">
        Enter the running total sold to date — not today&apos;s extra
        tickets. The figure you enter becomes the reported total,
        overriding automated feeds. Purchases and cost-per-ticket update
        as soon as you save.
      </p>

      {events.length === 0 ? (
        <p className="mt-10 font-[family-name:var(--admin-mono)] text-[12px] text-[#666]">
          No events on this account yet.
        </p>
      ) : (
        <div className="mt-8 border-t-[0.5px] border-black">
          {events.map((event) => (
            <ReportTicketSalesForm
              key={event.eventId}
              clientSlug={membership.clientSlug}
              event={event}
            />
          ))}
        </div>
      )}
    </div>
  );
}
