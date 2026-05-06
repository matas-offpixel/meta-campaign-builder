import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/dashboard/page-header";
import { FUNNEL_STAGE_PRESETS } from "@/lib/audiences/funnel-presets";
import {
  AUDIENCE_STATUS_LABELS,
  AUDIENCE_SUBTYPE_LABELS,
  FUNNEL_STAGE_LABELS,
  isAudienceStatus,
  isFunnelStage,
} from "@/lib/audiences/metadata";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { listAudiencesForClient } from "@/lib/db/meta-custom-audiences";
import { createClient } from "@/lib/supabase/server";
import { AudienceListActions } from "./audience-list-actions";
import type {
  AudienceStatus,
  FunnelStage,
  MetaCustomAudience,
} from "@/lib/types/audience";
import { AudienceRowActions } from "./audience-row-actions";
import { CopyableMetaId } from "./copyable-meta-id";

interface Props {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{
    stage?: string;
    status?: string;
    scope?: string;
  }>;
}

const STAGE_TABS: Array<{ id: "all" | FunnelStage; label: string }> = [
  { id: "all", label: "All" },
  { id: "top_of_funnel", label: "Top" },
  { id: "mid_funnel", label: "Mid" },
  { id: "bottom_funnel", label: "Bottom" },
  { id: "retargeting", label: "Retargeting" },
];

export default async function AudiencesPage({ params, searchParams }: Props) {
  const { clientId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await getClientByIdServer(clientId);
  if (!client) notFound();

  const activeStage = isFunnelStage(sp.stage) ? sp.stage : undefined;
  const statuses = parseStatuses(sp.status);
  const scope = parseScope(sp.scope);
  const audiences = await listAudiencesForClient(clientId, {
    funnelStage: activeStage,
    status: statuses,
  });
  const scopedAudiences = audiences.filter((audience) => {
    if (scope === "client") return !audience.eventId;
    if (scope === "event") return Boolean(audience.eventId);
    return true;
  });
  const eventMap = await loadEventMap(
    supabase,
    scopedAudiences.map((audience) => audience.eventId).filter(Boolean) as string[],
  );
  const writesEnabled =
    process.env.OFFPIXEL_META_AUDIENCE_WRITES_ENABLED === "true";
  const draftAudienceIds = scopedAudiences
    .filter((audience) => audience.status === "draft")
    .map((audience) => audience.id);

  return (
    <>
      <PageHeader
        title={`${client.name} audiences`}
        description={`Meta custom audiences bound to ${client.meta_ad_account_id ?? "no ad account"}.`}
        actions={
          <AudienceListActions
            clientId={clientId}
            draftAudienceIds={draftAudienceIds}
            writesEnabled={writesEnabled}
          />
        }
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <nav className="flex flex-wrap gap-2">
            {STAGE_TABS.map((tab) => (
              <FilterLink
                key={tab.id}
                href={buildHref(clientId, {
                  stage: tab.id === "all" ? undefined : tab.id,
                  status: sp.status,
                  scope,
                })}
                active={(activeStage ?? "all") === tab.id}
              >
                {tab.label}
              </FilterLink>
            ))}
          </nav>
          <div className="flex flex-wrap gap-2">
            {(["all", "draft", "ready", "failed", "archived"] as const).map(
              (status) => (
                <FilterLink
                  key={status}
                  href={buildHref(clientId, {
                    stage: activeStage,
                    status: status === "all" ? "all" : status,
                    scope,
                  })}
                  active={(sp.status ?? "default") === (status === "all" ? "all" : status)}
                >
                  {status === "all"
                    ? "All statuses"
                    : AUDIENCE_STATUS_LABELS[status]}
                </FilterLink>
              ),
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(["default", "client", "event"] as const).map((scopeOption) => (
              <FilterLink
                key={scopeOption}
                href={buildHref(clientId, {
                  stage: activeStage,
                  status: sp.status,
                  scope: scopeOption,
                })}
                active={scope === scopeOption}
              >
                {scopeLabel(scopeOption)}
              </FilterLink>
            ))}
          </div>

          {scopedAudiences.length > 0 ? (
            <AudienceTable
              audiences={scopedAudiences}
              clientId={clientId}
              eventMap={eventMap}
              writesEnabled={writesEnabled}
            />
          ) : (
            <EmptyState clientId={clientId} />
          )}
        </div>
      </main>
    </>
  );
}

function AudienceTable({
  audiences,
  clientId,
  eventMap,
  writesEnabled,
}: {
  audiences: MetaCustomAudience[];
  clientId: string;
  eventMap: Map<string, { name: string; event_code: string | null }>;
  writesEnabled: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Funnel</th>
            <th className="px-4 py-3">Subtype</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">Retention</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Meta ID</th>
            <th className="px-4 py-3">Event</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {audiences.map((audience) => {
            const event = audience.eventId
              ? eventMap.get(audience.eventId)
              : null;
            return (
              <tr key={audience.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">{audience.name}</td>
                <td className="px-4 py-3">
                  <Badge variant="primary">
                    {FUNNEL_STAGE_LABELS[audience.funnelStage]}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {AUDIENCE_SUBTYPE_LABELS[audience.audienceSubtype]}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {sourceDescription(audience)}
                </td>
                <td className="px-4 py-3">{audience.retentionDays}d</td>
                <td className="px-4 py-3">
                  <Badge variant={statusVariant(audience.status)}>
                    {AUDIENCE_STATUS_LABELS[audience.status]}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {audience.metaAudienceId ? (
                    <CopyableMetaId id={audience.metaAudienceId} />
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {audience.eventId && event ? (
                    <Link
                      href={`/events/${audience.eventId}`}
                      className="text-primary-hover hover:underline"
                    >
                      {event.event_code || event.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Client-wide</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <AudienceRowActions
                    audienceId={audience.id}
                    clientId={clientId}
                    status={audience.status}
                    writesEnabled={writesEnabled}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ clientId }: { clientId: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-8 text-center">
      <p className="font-heading text-xl tracking-wide">No audience drafts yet</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Start from Matas-approved presets, choose live sources, then save drafts
        or create them in Meta when writes are enabled.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {(["top_of_funnel", "mid_funnel", "bottom_funnel"] as const).map(
          (stage) => (
            <Link
              key={stage}
              href={`/audiences/${clientId}/new?presetBundle=${stage}`}
              className="rounded-md border border-border-strong px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              Create {FUNNEL_STAGE_LABELS[stage]} presets (
              {FUNNEL_STAGE_PRESETS[stage].length})
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

async function loadEventMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventIds: string[],
): Promise<Map<string, { name: string; event_code: string | null }>> {
  const map = new Map<string, { name: string; event_code: string | null }>();
  if (eventIds.length === 0) return map;
  const { data, error } = await supabase
    .from("events")
    .select("id, name, event_code")
    .in("id", eventIds);
  if (error) return map;
  for (const event of (data ?? []) as {
    id: string;
    name: string;
    event_code: string | null;
  }[]) {
    map.set(event.id, { name: event.name, event_code: event.event_code });
  }
  return map;
}

function parseStatuses(raw: string | undefined): AudienceStatus[] {
  if (raw === "all") return [];
  if (!raw) return ["draft", "ready", "failed"];
  const statuses = raw.split(",").filter(isAudienceStatus);
  return statuses.length > 0 ? statuses : ["draft", "ready", "failed"];
}

function parseScope(raw: string | undefined): "default" | "client" | "event" {
  if (raw === "client" || raw === "event") return raw;
  return "default";
}

function scopeLabel(scope: "default" | "client" | "event"): string {
  if (scope === "client") return "Client-wide only";
  if (scope === "event") return "Event-specific";
  return "All scopes";
}

function buildHref(
  clientId: string,
  params: {
    stage?: FunnelStage;
    status?: string;
    scope?: "default" | "client" | "event";
  },
): string {
  const sp = new URLSearchParams();
  if (params.stage) sp.set("stage", params.stage);
  if (params.status && params.status !== "default") sp.set("status", params.status);
  if (params.scope && params.scope !== "default") sp.set("scope", params.scope);
  const query = sp.toString();
  return query ? `/audiences/${clientId}?${query}` : `/audiences/${clientId}`;
}

function statusVariant(status: AudienceStatus) {
  if (status === "ready") return "success";
  if (status === "failed") return "destructive";
  if (status === "creating") return "warning";
  return "outline";
}

function sourceDescription(audience: MetaCustomAudience): string {
  const meta = audience.sourceMeta as Record<string, unknown>;
  if (audience.audienceSubtype.startsWith("page_")) {
    const source = audience.audienceSubtype.endsWith("_ig") ? "IG" : "FB Page";
    const pageIds = meta.pageIds as string[] | undefined;
    if (Array.isArray(pageIds) && pageIds.length > 1) {
      const first = String(meta.pageName ?? meta.pageSlug ?? pageIds[0]);
      const rest = pageIds.length - 1;
      return `${source}: ${first} + ${rest} other${rest === 1 ? "" : "s"}`;
    }
    return `${source}: ${String(meta.pageName ?? meta.pageSlug ?? audience.sourceId)}`;
  }
  if (audience.audienceSubtype === "video_views") {
    const videos = Array.isArray(meta.videoIds) ? meta.videoIds.length : 0;
    const summaries = meta.campaignSummaries as
      | Array<{ id: string; name: string }>
      | undefined;
    if (Array.isArray(summaries) && summaries.length > 0) {
      const firstName = summaries[0]!.name;
      const others = summaries.length - 1;
      const middle =
        others > 0
          ? `${firstName} + ${others} other${others === 1 ? "" : "s"}`
          : firstName;
      return `Campaigns: ${middle} (${videos} videos)`;
    }
    return `Campaigns: ${String(meta.campaignName ?? "Selected campaign")} (${videos} videos)`;
  }
  if (audience.audienceSubtype === "website_pixel") {
    return `Pixel: ${String(meta.pixelName ?? audience.sourceId)} (${String(meta.pixelEvent ?? "PageView")})`;
  }
  return audience.sourceId;
}
