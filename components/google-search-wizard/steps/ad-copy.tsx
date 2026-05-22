"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  addRsa,
  addSitelink,
  moveSitelink,
  removeRsa,
  removeSitelink,
  setRsaDescriptions,
  setRsaHeadlines,
  updateRsa,
  updateSitelink,
} from "@/lib/google-search/tree-mutations";
import {
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchAdGroupNode,
  type GoogleSearchCampaignNode,
  type GoogleSearchPlanTree,
  type GoogleSearchRsa,
  type GoogleSearchSitelink,
  type RsaDescription,
  type RsaHeadline,
} from "@/lib/google-search/types";

interface Props {
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}

const MAX_HEADLINES = 15;
const MAX_DESCRIPTIONS = 4;

export function AdCopyStep({ tree, onChange }: Props) {
  if (tree.campaigns.length === 0) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Ad copy</CardTitle>
            <CardDescription>Add a campaign + ad group before writing ad copy.</CardDescription>
          </CardHeader>
        </Card>
        <SitelinksSection tree={tree} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tree.campaigns.map((c) => (
        <CampaignSection key={c.id} campaign={c} tree={tree} onChange={onChange} />
      ))}
      <SitelinksSection tree={tree} onChange={onChange} />
    </div>
  );
}

function CampaignSection({
  campaign,
  tree,
  onChange,
}: {
  campaign: GoogleSearchCampaignNode;
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{campaign.name || "(unnamed campaign)"}</CardTitle>
        <CardDescription>
          {campaign.ad_groups.length} ad group{campaign.ad_groups.length === 1 ? "" : "s"} • RSA copy
          per ad group. Google requires ≥3 headlines + ≥2 descriptions per RSA.
        </CardDescription>
      </CardHeader>

      {campaign.ad_groups.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No ad groups in this campaign.
        </p>
      ) : (
        <div className="space-y-3">
          {campaign.ad_groups.map((ag) => (
            <AdGroupRsaBlock
              key={ag.id}
              campaignId={campaign.id}
              adGroup={ag}
              tree={tree}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function AdGroupRsaBlock({
  campaignId,
  adGroup,
  tree,
  onChange,
}: {
  campaignId: string;
  adGroup: GoogleSearchAdGroupNode;
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}) {
  return (
    <section className="rounded-md border border-border bg-background p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{adGroup.name}</p>
          <p className="text-xs text-muted-foreground">
            {adGroup.rsas.length} RSA{adGroup.rsas.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(addRsa(tree, campaignId, adGroup.id))}
        >
          <Plus className="h-3.5 w-3.5" />
          New RSA
        </Button>
      </header>

      {adGroup.rsas.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          No RSA copy yet for this ad group.
        </p>
      ) : (
        <div className="space-y-4">
          {adGroup.rsas.map((rsa, idx) => (
            <RsaEditor
              key={rsa.id}
              index={idx}
              rsa={rsa}
              onPatch={(patch) => onChange(updateRsa(tree, campaignId, adGroup.id, rsa.id, patch))}
              onHeadlines={(hl) =>
                onChange(setRsaHeadlines(tree, campaignId, adGroup.id, rsa.id, hl))
              }
              onDescriptions={(dl) =>
                onChange(setRsaDescriptions(tree, campaignId, adGroup.id, rsa.id, dl))
              }
              onRemove={() => onChange(removeRsa(tree, campaignId, adGroup.id, rsa.id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RsaEditor({
  index,
  rsa,
  onPatch,
  onHeadlines,
  onDescriptions,
  onRemove,
}: {
  index: number;
  rsa: GoogleSearchRsa;
  onPatch: (patch: Partial<GoogleSearchRsa>) => void;
  onHeadlines: (hl: RsaHeadline[]) => void;
  onDescriptions: (dl: RsaDescription[]) => void;
  onRemove: () => void;
}) {
  function setHeadline(i: number, text: string) {
    const next = [...rsa.headlines];
    next[i] = { ...(next[i] ?? { text: "" }), text };
    onHeadlines(next);
  }
  function removeHeadline(i: number) {
    onHeadlines(rsa.headlines.filter((_, j) => j !== i));
  }
  function addHeadline() {
    if (rsa.headlines.length >= MAX_HEADLINES) return;
    onHeadlines([...rsa.headlines, { text: "" }]);
  }
  function setDescription(i: number, text: string) {
    const next = [...rsa.descriptions];
    next[i] = { ...(next[i] ?? { text: "" }), text };
    onDescriptions(next);
  }
  function removeDescription(i: number) {
    onDescriptions(rsa.descriptions.filter((_, j) => j !== i));
  }
  function addDescription() {
    if (rsa.descriptions.length >= MAX_DESCRIPTIONS) return;
    onDescriptions([...rsa.descriptions, { text: "" }]);
  }

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <header className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          RSA {index + 1}
        </p>
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove RSA">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground">
            Headlines{" "}
            <span className="text-muted-foreground">
              ({rsa.headlines.length} / {MAX_HEADLINES}, ≥{GOOGLE_SEARCH_LIMITS.MIN_HEADLINES_PER_RSA} required)
            </span>
          </p>
          <div className="space-y-1.5">
            {rsa.headlines.map((h, i) => (
              <CharLimitedRow
                key={i}
                value={h.text}
                max={GOOGLE_SEARCH_LIMITS.HEADLINE_MAX_CHARS}
                onChange={(v) => setHeadline(i, v)}
                onRemove={() => removeHeadline(i)}
                ariaLabel={`Headline ${i + 1}`}
              />
            ))}
            {rsa.headlines.length < MAX_HEADLINES && (
              <Button variant="outline" size="sm" onClick={addHeadline}>
                <Plus className="h-3.5 w-3.5" />
                Add headline
              </Button>
            )}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground">
            Descriptions{" "}
            <span className="text-muted-foreground">
              ({rsa.descriptions.length} / {MAX_DESCRIPTIONS}, ≥
              {GOOGLE_SEARCH_LIMITS.MIN_DESCRIPTIONS_PER_RSA} required)
            </span>
          </p>
          <div className="space-y-1.5">
            {rsa.descriptions.map((d, i) => (
              <CharLimitedRow
                key={i}
                value={d.text}
                max={GOOGLE_SEARCH_LIMITS.DESCRIPTION_MAX_CHARS}
                onChange={(v) => setDescription(i, v)}
                onRemove={() => removeDescription(i)}
                ariaLabel={`Description ${i + 1}`}
              />
            ))}
            {rsa.descriptions.length < MAX_DESCRIPTIONS && (
              <Button variant="outline" size="sm" onClick={addDescription}>
                <Plus className="h-3.5 w-3.5" />
                Add description
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Input
          label="Final URL"
          value={rsa.final_url ?? ""}
          onChange={(e) => onPatch({ final_url: e.target.value || null })}
          placeholder="https://example.com/tickets"
        />
        <Input
          label={`Display path 1 (≤${GOOGLE_SEARCH_LIMITS.PATH_MAX_CHARS} chars)`}
          value={rsa.path1 ?? ""}
          onChange={(e) => onPatch({ path1: e.target.value || null })}
          maxLength={GOOGLE_SEARCH_LIMITS.PATH_MAX_CHARS}
          placeholder="tickets"
        />
        <Input
          label={`Display path 2 (≤${GOOGLE_SEARCH_LIMITS.PATH_MAX_CHARS} chars)`}
          value={rsa.path2 ?? ""}
          onChange={(e) => onPatch({ path2: e.target.value || null })}
          maxLength={GOOGLE_SEARCH_LIMITS.PATH_MAX_CHARS}
          placeholder="london"
        />
      </div>
    </div>
  );
}

function SitelinksSection({
  tree,
  onChange,
}: {
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Sitelinks</CardTitle>
            <CardDescription>
              Pushed to every campaign at launch. Each defaults its URL to the RSA landing
              page — override per sitelink if needed. Google requires ≥{
                GOOGLE_SEARCH_LIMITS.RECOMMENDED_MIN_SITELINKS
              } to show under the ad; if you push fewer, the account-level sitelinks may
              show instead (Account-level inheritance can&apos;t be disabled per-campaign via
              the API).
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange(addSitelink(tree))}
          >
            <Plus className="h-3.5 w-3.5" />
            Add sitelink
          </Button>
        </div>
      </CardHeader>

      {tree.sitelinks.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No sitelinks yet. Click &quot;Add sitelink&quot; to start.
        </p>
      ) : (
        <div className="space-y-3">
          {tree.sitelinks.map((sl, idx) => (
            <SitelinkEditor
              key={sl.id}
              index={idx}
              total={tree.sitelinks.length}
              sitelink={sl}
              onPatch={(patch) => onChange(updateSitelink(tree, sl.id, patch))}
              onRemove={() => onChange(removeSitelink(tree, sl.id))}
              onMoveUp={() => onChange(moveSitelink(tree, sl.id, -1))}
              onMoveDown={() => onChange(moveSitelink(tree, sl.id, 1))}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function SitelinkEditor({
  index,
  total,
  sitelink,
  onPatch,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  index: number;
  total: number;
  sitelink: GoogleSearchSitelink;
  onPatch: (patch: Partial<GoogleSearchSitelink>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const linkTextLen = [...(sitelink.link_text ?? "")].length;
  const desc1Len = [...(sitelink.description1 ?? "")].length;
  const desc2Len = [...(sitelink.description2 ?? "")].length;
  const linkOver = linkTextLen > GOOGLE_SEARCH_LIMITS.SITELINK_LINK_TEXT_MAX_CHARS;
  const desc1Over = desc1Len > GOOGLE_SEARCH_LIMITS.SITELINK_DESCRIPTION_MAX_CHARS;
  const desc2Over = desc2Len > GOOGLE_SEARCH_LIMITS.SITELINK_DESCRIPTION_MAX_CHARS;

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <header className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Sitelink {index + 1}
          {sitelink.pushed_resource_name ? (
            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-900">
              pushed
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label="Move sitelink up"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onMoveDown}
            disabled={index === total - 1}
            aria-label="Move sitelink down"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove sitelink">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium">
            Link text{" "}
            <span
              className={`tabular-nums ${linkOver ? "text-destructive" : "text-muted-foreground"}`}
            >
              ({linkTextLen}/{GOOGLE_SEARCH_LIMITS.SITELINK_LINK_TEXT_MAX_CHARS})
            </span>
          </label>
          <input
            aria-label={`Sitelink ${index + 1} link text`}
            value={sitelink.link_text}
            onChange={(e) => onPatch({ link_text: e.target.value })}
            placeholder="Tickets"
            className={`h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring ${
              linkOver ? "border-destructive" : "border-border-strong"
            }`}
          />
        </div>
        <Input
          label="Final URL (optional — defaults to plan landing URL)"
          value={sitelink.final_url ?? ""}
          onChange={(e) => onPatch({ final_url: e.target.value || null })}
          placeholder="https://example.com/tickets"
        />
        <div>
          <label className="mb-1 block text-xs font-medium">
            Description 1{" "}
            <span
              className={`tabular-nums ${desc1Over ? "text-destructive" : "text-muted-foreground"}`}
            >
              ({desc1Len}/{GOOGLE_SEARCH_LIMITS.SITELINK_DESCRIPTION_MAX_CHARS})
            </span>
          </label>
          <input
            aria-label={`Sitelink ${index + 1} description 1`}
            value={sitelink.description1 ?? ""}
            onChange={(e) => onPatch({ description1: e.target.value || null })}
            placeholder="Secure your place"
            className={`h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring ${
              desc1Over ? "border-destructive" : "border-border-strong"
            }`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">
            Description 2{" "}
            <span
              className={`tabular-nums ${desc2Over ? "text-destructive" : "text-muted-foreground"}`}
            >
              ({desc2Len}/{GOOGLE_SEARCH_LIMITS.SITELINK_DESCRIPTION_MAX_CHARS})
            </span>
          </label>
          <input
            aria-label={`Sitelink ${index + 1} description 2`}
            value={sitelink.description2 ?? ""}
            onChange={(e) => onPatch({ description2: e.target.value || null })}
            placeholder="Limited availability"
            className={`h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring ${
              desc2Over ? "border-destructive" : "border-border-strong"
            }`}
          />
        </div>
      </div>
    </div>
  );
}

export function CharLimitedRow({
  value,
  max,
  onChange,
  onRemove,
  ariaLabel,
}: {
  value: string;
  max: number;
  onChange: (next: string) => void;
  onRemove: () => void;
  ariaLabel: string;
}) {
  const length = [...value].length;
  const over = length > max;
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 items-center gap-2">
        <input
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring ${
            over ? "border-destructive" : "border-border-strong"
          }`}
        />
        <span
          className={`min-w-[3rem] text-right text-[11px] tabular-nums ${
            over ? "font-medium text-destructive" : "text-muted-foreground"
          }`}
          data-testid="char-counter"
        >
          {length}/{max}
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${ariaLabel}`}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
