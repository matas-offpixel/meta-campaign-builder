"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PageAudiencesPanel } from "./page-audiences-panel";
import { CustomAudiencesPanel } from "./custom-audiences-panel";
import { SavedAudiencesPanel } from "./saved-audiences-panel";
import { InterestGroupsPanel } from "./interest-groups-panel";
import type { AudienceSettings, AudienceTab } from "@/lib/types";
import { suggestAgeRange } from "@/lib/interest-suggestions";
import { FUNNEL_STAGE_LABELS } from "@/lib/audiences/metadata";
import type { MetaCustomAudience } from "@/lib/types/audience";

interface AudiencesStepProps {
  audiences: AudienceSettings;
  onChange: (audiences: AudienceSettings) => void;
  /** Meta ad account ID — used to auto-load Business Manager pages */
  adAccountId?: string;
  /** Client/event context for opening the standalone Audience Creator. */
  clientId?: string;
  eventId?: string;
  /** Campaign/event name passed to AI interest discovery for richer suggestions */
  campaignName?: string;
}

export function AudiencesStep({
  audiences,
  onChange,
  adAccountId,
  clientId,
  eventId,
  campaignName,
}: AudiencesStepProps) {
  const [activeTab, setActiveTab] = useState<AudienceTab>("pages");

  const suggestedAge = useMemo(() => suggestAgeRange(audiences), [audiences]);
  const hasPages = audiences.pageGroups.some((g) => g.pageIds.length > 0);

  const tabs = [
    { id: "pages" as const, label: "Page Audiences", count: audiences.pageGroups.length },
    { id: "custom" as const, label: "Custom Audiences", count: audiences.customAudienceGroups.length },
    { id: "offpixel_custom" as const, label: "Custom Audiences (Off/Pixel)", count: audiences.offpixelCustomAudienceIds?.length ?? 0 },
    { id: "saved" as const, label: "Saved Audiences", count: audiences.savedAudiences.audienceIds.length },
    { id: "interests" as const, label: "Interest Groups", count: audiences.interestGroups.length },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl tracking-wide">Audiences</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Build your targeting by combining page audiences, custom audiences, saved audiences, and interests.
          </p>
        </div>
        {hasPages && (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5">
            <span className="text-xs text-muted-foreground">Suggested age:</span>
            <Badge variant="primary">{suggestedAge.min}–{suggestedAge.max}</Badge>
          </div>
        )}
      </div>

      {clientId && (
        <div className="rounded-md border border-border bg-card p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground">
              Need a new custom audience? Open the Audience Creator in a new tab.
            </p>
            <Link
              href={`/audiences/${clientId}/new${eventId ? `?event_id=${eventId}&return_to=wizard` : "?return_to=wizard"}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              Create new audience
            </Link>
          </div>
        </div>
      )}

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={(id) => setActiveTab(id as AudienceTab)} />

      <TabPanel active={activeTab === "pages"}>
        <PageAudiencesPanel
          groups={audiences.pageGroups}
          onChange={(pageGroups) => onChange({ ...audiences, pageGroups })}
          adAccountId={adAccountId}
          splalGroups={audiences.selectedPagesLookalikeGroups ?? []}
          onSplalGroupsChange={(selectedPagesLookalikeGroups) => onChange({ ...audiences, selectedPagesLookalikeGroups })}
        />
      </TabPanel>
      <TabPanel active={activeTab === "custom"}>
        <CustomAudiencesPanel groups={audiences.customAudienceGroups} onChange={(customAudienceGroups) => onChange({ ...audiences, customAudienceGroups })} adAccountId={adAccountId} />
      </TabPanel>
      <TabPanel active={activeTab === "offpixel_custom"}>
        {clientId ? (
          <OffPixelCustomAudiencesPanel
            clientId={clientId}
            selectedIds={audiences.offpixelCustomAudienceIds ?? []}
            onChange={(offpixelCustomAudienceIds) =>
              onChange({ ...audiences, offpixelCustomAudienceIds })
            }
          />
        ) : (
          <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            Select a client in Account Setup before choosing Off/Pixel audiences.
          </p>
        )}
      </TabPanel>
      <TabPanel active={activeTab === "saved"}>
        <SavedAudiencesPanel
          selection={audiences.savedAudiences}
          onChange={(savedAudiences) => onChange({ ...audiences, savedAudiences })}
          adAccountId={adAccountId}
        />
      </TabPanel>
      <TabPanel active={activeTab === "interests"}>
        <InterestGroupsPanel
          groups={audiences.interestGroups}
          audiences={audiences}
          onChange={(interestGroups) => onChange({ ...audiences, interestGroups })}
          campaignName={campaignName}
        />
      </TabPanel>
    </div>
  );
}

function OffPixelCustomAudiencesPanel({
  clientId,
  selectedIds,
  onChange,
}: {
  clientId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [audiences, setAudiences] = useState<MetaCustomAudience[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAudiences() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/audiences?clientId=${clientId}&status=ready`);
        const json = (await res.json()) as
          | { ok: true; audiences: MetaCustomAudience[] }
          | { ok: false; error: string };
        if (!res.ok || !json.ok) {
          throw new Error(json.ok ? "Failed to load audiences" : json.error);
        }
        if (!cancelled) setAudiences(json.audiences);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load audiences");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadAudiences();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const grouped = useMemo(() => {
    return audiences.reduce<Record<string, MetaCustomAudience[]>>((acc, audience) => {
      (acc[audience.funnelStage] ??= []).push(audience);
      return acc;
    }, {});
  }, [audiences]);

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Off/Pixel Custom Audiences</h3>
          <p className="text-xs text-muted-foreground">
            Ready audiences created in the Audience Builder, grouped by funnel stage.
          </p>
        </div>
        <Link
          href={`/audiences/${clientId}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          Open Audience Builder
        </Link>
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading audiences...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && audiences.length === 0 && (
        <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          No ready Off/Pixel audiences yet.
        </p>
      )}
      {Object.entries(grouped).map(([stage, rows]) => (
        <section key={stage} className="rounded-md border border-border bg-card">
          <div className="border-b border-border px-4 py-2 text-sm font-semibold">
            {FUNNEL_STAGE_LABELS[stage as keyof typeof FUNNEL_STAGE_LABELS]} ({rows.length})
          </div>
          <div className="divide-y divide-border">
            {rows.map((audience) => (
              <label
                key={audience.id}
                className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(audience.id)}
                  onChange={() => toggle(audience.id)}
                />
                <span className="flex-1">{audience.name}</span>
                <span className="text-xs text-muted-foreground">
                  {audience.retentionDays}d
                </span>
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
