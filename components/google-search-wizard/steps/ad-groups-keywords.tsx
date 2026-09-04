"use client";

import { CardDescription, Datum, StatusLine, StepSurfaceProvider, type StepSurface } from "@/components/steps/step-surface";
import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  addAdGroup,
  addKeyword,
  removeAdGroup,
  removeKeyword,
  updateAdGroup,
  updateKeyword,
} from "@/lib/google-search/tree-mutations";
import {
  MATCH_TYPES,
  type GoogleSearchAdGroupNode,
  type GoogleSearchCampaignNode,
  type GoogleSearchKeyword,
  type GoogleSearchMatchType,
  type GoogleSearchPlanTree,
} from "@/lib/google-search/types";
import { isDerivedGoogleNote } from "@/lib/plan/derive/google";
import { InfoTip } from "@/components/viz/info-tip";
import { ProvenanceBadge } from "@/components/viz/provenance-badge";
import { GOOGLE_DRAWER_COPY } from "@/lib/plan/drawer";

interface Props {
  surface?: StepSurface;
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}

export function AdGroupsKeywordsStep({ surface = "wizard", tree, onChange }: Props) {
  if (tree.campaigns.length === 0) {
    return (
      <StepSurfaceProvider surface={surface}>
        <Card>
          <CardHeader>
            <CardTitle>Ad groups & keywords</CardTitle>
            <CardDescription>Add a campaign in the previous step before defining ad groups.</CardDescription>
          </CardHeader>
        </Card>
      </StepSurfaceProvider>
    );
  }

  return (
    <StepSurfaceProvider surface={surface}>
    <div className="space-y-4">
      {tree.campaigns.map((campaign) => (
        <CampaignBlock
          key={campaign.id}
          tree={tree}
          campaign={campaign}
          onChange={onChange}
        />
      ))}
    </div>
      </StepSurfaceProvider>
  );
}

function CampaignBlock({
  tree,
  campaign,
  onChange,
}: {
  tree: GoogleSearchPlanTree;
  campaign: GoogleSearchCampaignNode;
  onChange: (next: GoogleSearchPlanTree) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>{campaign.name || "(unnamed campaign)"}</CardTitle>
            <CardDescription>
              {campaign.ad_groups.length} ad group{campaign.ad_groups.length === 1 ? "" : "s"} •{" "}
              {campaign.ad_groups.reduce((s, ag) => s + ag.keywords.length, 0)} keyword(s) total
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => onChange(addAdGroup(tree, campaign.id))}>
            <Plus className="h-4 w-4" />
            Add ad group
          </Button>
        </div>
      </CardHeader>

      {campaign.ad_groups.length === 0 ? (
        <Datum className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No ad groups in this campaign yet.
        </Datum>
      ) : (
        <div className="space-y-3">
          {campaign.ad_groups.map((adGroup) => (
            <AdGroupCard
              key={adGroup.id}
              campaignId={campaign.id}
              campaignName={campaign.name}
              adGroup={adGroup}
              tree={tree}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function AdGroupCard({
  campaignId,
  campaignName,
  adGroup,
  tree,
  onChange,
}: {
  campaignId: string;
  campaignName: string;
  adGroup: GoogleSearchAdGroupNode;
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="rounded-md border border-border bg-background">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-left"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <input
            value={adGroup.name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              onChange(updateAdGroup(tree, campaignId, adGroup.id, { name: e.target.value }))
            }
            className="rounded-md bg-transparent text-sm font-medium focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={`Ad group name for ${campaignName}`}
          />
          <span className="text-xs text-muted-foreground">
            {adGroup.keywords.length} keyword{adGroup.keywords.length === 1 ? "" : "s"}
          </span>
        </button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange(addKeyword(tree, campaignId, adGroup.id, ""))
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Keyword
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (window.confirm(`Remove ad group "${adGroup.name}" and its ${adGroup.keywords.length} keyword(s)?`)) {
                onChange(removeAdGroup(tree, campaignId, adGroup.id));
              }
            }}
            aria-label="Remove ad group"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {expanded && (
        <div className="p-3">
          {adGroup.keywords.length === 0 ? (
            <StatusLine className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No keywords yet. Add one to get going.
            </StatusLine>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">Keyword</th>
                  <th className="w-28 px-2 py-1">Match</th>
                  <th className="w-10 px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {adGroup.keywords.map((kw) => (
                  <KeywordRow
                    key={kw.id}
                    keyword={kw}
                    onPatch={(patch) =>
                      onChange(updateKeyword(tree, campaignId, adGroup.id, kw.id, patch))
                    }
                    onRemove={() =>
                      onChange(removeKeyword(tree, campaignId, adGroup.id, kw.id))
                    }
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

function KeywordRow({
  keyword,
  onPatch,
  onRemove,
}: {
  keyword: GoogleSearchKeyword;
  onPatch: (patch: Partial<GoogleSearchKeyword>) => void;
  onRemove: () => void;
}) {
  const derived = isDerivedGoogleNote(keyword.notes);
  const cpcRange =
    keyword.est_cpc_low != null && keyword.est_cpc_high != null
      ? `${keyword.est_cpc_low.toFixed(2)} – ${keyword.est_cpc_high.toFixed(2)}`
      : "";
  const tip = [keyword.intent, cpcRange ? `£${cpcRange}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <tr className="border-t border-border align-middle">
      <td className="px-2 py-1">
        <div className="flex items-center gap-1">
          <Input
            aria-label="Keyword text"
            value={keyword.keyword}
            onChange={(e) => onPatch({ keyword: e.target.value })}
            placeholder="event tickets london"
          />
          {derived ? <ProvenanceBadge provenance="derived" /> : null}
          {tip ? <InfoTip label={`${GOOGLE_DRAWER_COPY.intentCpcTip} ${tip}`} /> : null}
        </div>
      </td>
      <td className="px-2 py-1">
        <Select
          aria-label="Match type"
          value={keyword.match_type}
          options={MATCH_TYPES.map((m) => ({ value: m, label: m }))}
          onChange={(e) => onPatch({ match_type: e.target.value as GoogleSearchMatchType })}
        />
      </td>
      <td className="px-2 py-1 text-right">
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove keyword">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

