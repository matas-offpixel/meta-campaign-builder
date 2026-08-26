"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, FileText, FolderOpen, Loader2, Rocket, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { loadCampaignList } from "@/lib/db/drafts";
import { loadTemplatesFromDb } from "@/lib/db/templates";
import type { CampaignListItem, CampaignTemplate } from "@/lib/types";
import {
  CampaignRow,
  filterLibraryCampaigns,
  filterLibraryTemplates,
  LibraryEmptyState,
  TemplateRow,
  type LibraryTab,
} from "@/components/library/library-rows";

export type LibraryPick =
  | { kind: "draft"; id: string }
  | { kind: "template"; id: string };

/**
 * Campaign library in a modal — same Drafts / Published / Archived /
 * Templates tabs and rows as `/`. Pick duplicates via the plan prepare
 * path; this surface never mutates the source.
 */
export function CampaignLibraryPicker({
  open,
  onClose,
  onPick,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (pick: LibraryPick) => void;
  busy?: boolean;
}) {
  const [tab, setTab] = useState<LibraryTab>("drafts");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const [items, tpls] = await Promise.all([
        loadCampaignList(user.id),
        loadTemplatesFromDb(user.id),
      ]);
      if (cancelled) return;
      setCampaigns(items);
      setTemplates(tpls);
      setTemplatesLoaded(true);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filteredCampaigns = useMemo(() => {
    if (tab === "templates") return [];
    return filterLibraryCampaigns(campaigns, tab, search);
  }, [campaigns, tab, search]);

  const filteredTemplates = useMemo(
    () => filterLibraryTemplates(templates, search),
    [templates, search],
  );

  const tabs: { id: LibraryTab; label: string; count: number }[] = [
    { id: "drafts", label: "Drafts", count: campaigns.filter((c) => c.status === "draft").length },
    { id: "published", label: "Published", count: campaigns.filter((c) => c.status === "published").length },
    { id: "archived", label: "Archived", count: campaigns.filter((c) => c.status === "archived").length },
    { id: "templates", label: "Templates", count: templates.length },
  ];

  return (
    <Dialog open={open} onClose={onClose} panelClassName="max-w-3xl">
      <DialogContent className="max-h-[80vh] overflow-hidden p-0">
        <div className="p-6 pb-0">
          <DialogHeader onClose={onClose} className="mb-3">
            <DialogTitle>From existing campaign</DialogTitle>
            <DialogDescription>
              Duplicates the source — the original is not changed — then applies
              this plan&apos;s name, event, URL, budget and schedule.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex items-center justify-between gap-4 border-b border-border px-6">
          <div className="flex gap-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative px-3 py-2.5 text-sm font-medium transition-colors
                  ${tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
                {t.count > 0 && (
                  <span className="ml-1.5 text-[10px] font-semibold text-muted-foreground">{t.count}</span>
                )}
                {tab === t.id && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-foreground rounded-full" />
                )}
              </button>
            ))}
          </div>
          <div className="relative mb-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-8 w-44 rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground
                placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-6 py-4">
          {loading || busy ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tab === "templates" ? (
            !templatesLoaded ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredTemplates.length === 0 ? (
              <LibraryEmptyState
                icon={FolderOpen}
                title="No templates yet"
                description="Save a campaign as a template to reuse it later."
              />
            ) : (
              <div className="space-y-2">
                {filteredTemplates.map((t) => (
                  <TemplateRow
                    key={t.id}
                    template={t}
                    variant="pick"
                    onPick={(template) => onPick({ kind: "template", id: template.id })}
                  />
                ))}
              </div>
            )
          ) : filteredCampaigns.length === 0 ? (
            <LibraryEmptyState
              icon={tab === "drafts" ? FileText : tab === "published" ? Rocket : Archive}
              title={
                tab === "drafts"
                  ? "No drafts"
                  : tab === "published"
                    ? "No published campaigns"
                    : "No archived campaigns"
              }
              description={
                tab === "drafts"
                  ? "Start a new campaign to get going."
                  : tab === "published"
                    ? "Published campaigns will appear here."
                    : "Archived campaigns will appear here."
              }
            />
          ) : (
            <div className="space-y-2">
              {filteredCampaigns.map((c) => (
                <CampaignRow
                  key={c.id}
                  campaign={c}
                  isLoading={false}
                  variant="pick"
                  onPick={(id) => onPick({ kind: "draft", id })}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
