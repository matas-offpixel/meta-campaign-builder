"use client";

import { useState, useMemo } from "react";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PageAudiencesPanel } from "./page-audiences-panel";
import { CustomAudiencesPanel } from "./custom-audiences-panel";
import { SavedAudiencesPanel } from "./saved-audiences-panel";
import { InterestGroupsPanel } from "./interest-groups-panel";
import type { AudienceSettings, AudienceTab } from "@/lib/types";
import { suggestAgeRange } from "@/lib/interest-suggestions";

interface AudiencesStepProps {
  audiences: AudienceSettings;
  onChange: (audiences: AudienceSettings) => void;
  /** Meta ad account ID — used to auto-load Business Manager pages */
  adAccountId?: string;
  /** Campaign/event name passed to AI interest discovery for richer suggestions */
  campaignName?: string;
}

export function AudiencesStep({ audiences, onChange, adAccountId, campaignName }: AudiencesStepProps) {
  const [activeTab, setActiveTab] = useState<AudienceTab>("pages");

  const suggestedAge = useMemo(() => suggestAgeRange(audiences), [audiences]);
  const hasPages = audiences.pageGroups.some((g) => g.pageIds.length > 0);

  const tabs = [
    { id: "pages" as const, label: "Page Audiences", count: audiences.pageGroups.length },
    { id: "custom" as const, label: "Custom Audiences", count: audiences.customAudienceGroups.length },
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
