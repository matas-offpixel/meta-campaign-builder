import { notFound, redirect } from "next/navigation";
import { ClientDetail } from "@/components/dashboard/clients/client-detail";
import { createClient } from "@/lib/supabase/server";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { listEventsServer } from "@/lib/db/events-server";
import {
  listInvoicesForClientWithRefsServer,
  listQuotesServer,
} from "@/lib/db/invoicing-server";
import { getShareForClient } from "@/lib/db/report-shares";
import { listLatestSnapshotsForClient } from "@/lib/db/client-snapshots-server";
import { listConnectionsForUser } from "@/lib/db/ticketing";
import {
  listD2CConnectionsForUser,
  listD2CTemplatesForUser,
} from "@/lib/db/d2c";
import { listCreativeTemplatesForUser } from "@/lib/db/creative-templates";
import { loadClientPortalByClientId } from "@/lib/db/client-portal-server";
import {
  isBannerbearEnabled,
  isCanvaEnabled,
  isPlacidEnabled,
} from "@/lib/creatives/types";
import { clientHasTaggedEvents } from "@/lib/reporting/creative-patterns-cross-event";
import type { ProviderStatus } from "@/components/dashboard/clients/creative-templates-panel";
import type { SettlementTiming } from "@/lib/pricing/calculator";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

const ALLOWED_TABS = new Set([
  "overview",
  "events",
  "ticketing",
  "d2c",
  "creatives",
  "invoicing",
]);

type ClientTab =
  | "overview"
  | "events"
  | "ticketing"
  | "d2c"
  | "creatives"
  | "invoicing";

export default async function ClientDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { tab } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // proxy.ts already enforces auth on dashboard routes; this is a defensive
  // fallback in case a route slips through.
  if (!user) redirect("/login");

  // Fetch everything the tab shell can possibly need in parallel — the
  // ticketing / d2c / creatives panels mount even when their tab isn't
  // active so the count badges in the tab bar are accurate without a
  // second round-trip. Each helper is RLS-scoped to the caller.
  const [
    client,
    events,
    clientInvoices,
    clientQuotes,
    share,
    latestSnapshots,
    ticketing,
    d2c,
    d2cTemplates,
    creativeTemplates,
    hasTaggedEvents,
    // PR D3 — fetch the client-portal payload alongside the other
    // loads so the Events tab can render the same venue-grouped
    // layout as `/clients/[id]/dashboard`. Fails soft (returns
    // `{ ok: false }`) when the client has no events, and the
    // Events tab renders the legacy flat table in that case.
    portal,
  ] = await Promise.all([
    getClientByIdServer(id),
    listEventsServer(user.id, { clientId: id }),
    listInvoicesForClientWithRefsServer(user.id, id),
    listQuotesServer(user.id, { client_id: id }),
    getShareForClient(id),
    listLatestSnapshotsForClient(user.id, id),
    listConnectionsForUser(supabase, { clientId: id }),
    listD2CConnectionsForUser(supabase, { clientId: id }),
    listD2CTemplatesForUser(supabase, { clientId: id }),
    listCreativeTemplatesForUser(supabase),
    clientHasTaggedEvents(id),
    loadClientPortalByClientId(id),
  ]);

  if (!client) notFound();

  const defaults = {
    upfront_pct: client.default_upfront_pct ?? 75,
    settlement_timing: (client.default_settlement_timing ??
      "1_month_before") as SettlementTiming,
  };

  const initialShare = share
    ? { token: share.token, enabled: share.enabled }
    : null;

  // Strip credentials before crossing the server→client boundary. The
  // panel components also enforce `credentials: null` in their own
  // prop types so this is belt-and-braces.
  const safeTicketing = ticketing.map((c) => ({
    ...c,
    credentials: null as null,
  }));
  const safeD2C = d2c.map((c) => ({
    ...c,
    credentials: null as null,
  }));

  const creativeProviderStatus: ProviderStatus[] = [
    {
      provider: "canva",
      label: "Canva Autofill",
      enabled: isCanvaEnabled(),
      flag: "FEATURE_CANVA_AUTOFILL",
      blurb:
        "Brand templates with autofill via Canva Connect. Requires Canva Enterprise approval.",
    },
    {
      provider: "bannerbear",
      label: "Bannerbear",
      enabled: isBannerbearEnabled(),
      flag: "FEATURE_BANNERBEAR",
      blurb:
        "Lightweight image / video render API. Self-serve account, no enterprise gate.",
    },
    {
      provider: "placid",
      label: "Placid",
      enabled: isPlacidEnabled(),
      flag: "FEATURE_PLACID",
      blurb:
        "Template-based render API with similar surface area to Bannerbear.",
    },
  ];

  const initialTab: ClientTab =
    tab && ALLOWED_TABS.has(tab) ? (tab as ClientTab) : "overview";

  return (
    <ClientDetail
      client={client}
      events={events}
      clientInvoices={clientInvoices}
      clientQuotes={clientQuotes}
      defaults={defaults}
      initialShare={initialShare}
      latestSnapshots={latestSnapshots}
      ticketingConnections={safeTicketing}
      d2cConnections={safeD2C}
      d2cTemplates={d2cTemplates}
      creativeTemplates={creativeTemplates}
      creativeProviderStatus={creativeProviderStatus}
      initialTab={initialTab}
      portal={portal.ok ? portal : null}
      hasTaggedEvents={hasTaggedEvents}
    />
  );
}
