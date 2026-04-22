import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { ReportingRollupPanel } from "@/components/dashboard/reporting/reporting-rollup-panel";
import { createClient } from "@/lib/supabase/server";
import { listClientsServer } from "@/lib/db/clients-server";
import {
  defaultRollupWindow,
  loadCrossEventRollup,
} from "@/lib/reporting/rollup-server";
import { parseUuid } from "@/lib/dashboard/format";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

type PlatformId = "meta" | "tiktok" | "google-ads";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const v = Array.isArray(value) ? value[0] : value;
  return v && DATE_RE.test(v) ? v : null;
}

function parsePlatform(value: string | string[] | undefined): PlatformId {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "tiktok" || v === "google-ads") return v;
  return "meta";
}

/**
 * /reporting — cross-event rollup.
 *
 * URL contract:
 *   ?client=<uuid>            optional client filter
 *   ?from=<YYYY-MM-DD>        window start (default: 30d ago)
 *   ?to=<YYYY-MM-DD>          window end (default: today)
 *   ?platform=meta|tiktok|google-ads  default: meta
 *
 * Server-rendered: every filter change reloads the page so the
 * rollup is always derived from a single load path. The client
 * panel only commits filter changes back to the URL.
 *
 * The Meta data source is the same `fetchEventCampaignInsights`
 * helper the per-event panel uses — narrowing the rollup to one
 * event with the same dates surfaces identical numbers (acceptance
 * criterion).
 */
export default async function ReportingPage({ searchParams }: Props) {
  const sp = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const clientId = parseUuid(sp.client);
  const platform = parsePlatform(sp.platform);
  const defaults = defaultRollupWindow();
  const since = parseDate(sp.from) ?? defaults.since;
  const until = parseDate(sp.to) ?? defaults.until;

  // Always load the client picker source — even when a filter is
  // active — so the dropdown still shows the full list.
  const clientsPromise = listClientsServer(user.id, { status: "active" });

  // Skip the Meta fan-out when the user has switched away from the
  // Meta tab. The placeholder panel doesn't need rollup data.
  const rollupPromise =
    platform === "meta"
      ? loadCrossEventRollup({
          userId: user.id,
          clientId,
          since,
          until,
        })
      : Promise.resolve(null);

  const [clients, rollup] = await Promise.all([clientsPromise, rollupPromise]);

  return (
    <>
      <PageHeader
        title="Reporting"
        description="Performance across events, blended Meta spend and CPR with per-account benchmark colour-coding."
      />
      <ReportingRollupPanel
        rows={rollup?.events ?? []}
        totals={
          rollup?.totals ?? {
            spend: 0,
            impressions: 0,
            clicks: 0,
            results: 0,
            ctr: null,
            cpm: null,
            cpr: null,
          }
        }
        benchmarksByAccount={rollup?.benchmarksByAccount ?? {}}
        window={rollup?.window ?? { since, until }}
        candidateEventsConsidered={rollup?.candidateEventsConsidered ?? 0}
        selected={{
          clientId,
          platform,
          since,
          until,
        }}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
      />
    </>
  );
}
