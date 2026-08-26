"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  FileText,
  Rocket,
  Archive,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { saveDraftToDb, loadCampaignList, duplicateCampaign, deleteCampaign, updateCampaignStatus } from "@/lib/db/drafts";
import { loadTemplatesFromDb, saveTemplateToDb, deleteTemplateFromDb } from "@/lib/db/templates";
import { applyTemplate } from "@/lib/templates";
import { SaveTemplateModal } from "@/components/templates/save-template-modal";
import { NewCampaignModal } from "@/components/library/new-campaign-modal";
import {
  CampaignRow,
  filterLibraryCampaigns,
  filterLibraryTemplates,
  LibraryEmptyState,
  TemplateRow,
  type LibraryTab,
} from "@/components/library/library-rows";
import type { CampaignListItem, CampaignDraft, CampaignTemplate } from "@/lib/types";

export function CampaignLibrary() {
  const router = useRouter();
  const [tab, setTab] = useState<LibraryTab>("drafts");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Save-as-template modal
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSourceId, setTemplateSourceId] = useState<string | null>(null);

  // "New Campaign" picker modal — replaces the old immediate-create flow
  // so the wizard always opens with client + event already linked.
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);

  // ─── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const items = await loadCampaignList(user.id);
      setCampaigns(items);
      setLoading(false);
    }
    init();
  }, []);

  const loadTemplatesList = useCallback(async () => {
    if (!userId) return;
    setTemplatesLoaded(false);
    const fetched = await loadTemplatesFromDb(userId);
    setTemplates(fetched);
    setTemplatesLoaded(true);
  }, [userId]);

  // Reset templatesLoaded when navigating away from the templates tab
  // so re-entering always fetches fresh data.
  useEffect(() => {
    if (tab !== "templates") {
      setTemplatesLoaded(false);
    }
  }, [tab]);

  useEffect(() => {
    if (tab === "templates" && !templatesLoaded && userId) {
      loadTemplatesList();
    }
  }, [tab, templatesLoaded, userId, loadTemplatesList]);

  // ─── Filtered lists ──────────────────────────────────────────────────────────
  const filteredCampaigns = useMemo(() => {
    if (tab === "templates") return [];
    return filterLibraryCampaigns(campaigns, tab, search);
  }, [campaigns, tab, search]);

  const filteredTemplates = useMemo(
    () => filterLibraryTemplates(templates, search),
    [templates, search],
  );

  // ─── Actions ─────────────────────────────────────────────────────────────────
  // Opens the picker modal. Draft creation + navigation happen inside
  // <NewCampaignModal /> after the user confirms a client + event so we
  // never leave an orphan draft if they back out.
  const handleNewCampaign = () => {
    if (!userId) return;
    setNewCampaignOpen(true);
  };

  const handleOpen = (id: string) => {
    router.push(`/campaign/${id}`);
  };

  const handleDuplicate = async (id: string) => {
    if (!userId) return;
    setActionLoading(id);
    const copy = await duplicateCampaign(id, userId);
    if (copy) {
      const items = await loadCampaignList(userId);
      setCampaigns(items);
    }
    setActionLoading(null);
  };

  const handleArchive = async (id: string) => {
    setActionLoading(id);
    await updateCampaignStatus(id, "archived");
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status: "archived" as const } : c)));
    setActionLoading(null);
  };

  const handleUnarchive = async (id: string) => {
    setActionLoading(id);
    await updateCampaignStatus(id, "draft");
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status: "draft" as const } : c)));
    setActionLoading(null);
  };

  const handleDelete = async (id: string) => {
    setActionLoading(id);
    await deleteCampaign(id);
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
    setConfirmDeleteId(null);
    setActionLoading(null);
  };

  const handleRelaunch = async (id: string) => {
    if (!userId) return;
    setActionLoading(id);
    const copy = await duplicateCampaign(id, userId);
    if (copy) router.push(`/campaign/${copy.id}`);
    setActionLoading(null);
  };

  const handleSaveAsTemplate = (id: string) => {
    setTemplateSourceId(id);
    setTemplateModalOpen(true);
  };

  const handleSaveTemplateConfirm = async (name: string, description: string, tags: string[]) => {
    if (!userId || !templateSourceId) return;
    setTemplateSaving(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("campaign_drafts")
        .select("draft_json")
        .eq("id", templateSourceId)
        .maybeSingle();

      if (data?.draft_json) {
        await saveTemplateToDb(data.draft_json as CampaignDraft, name, description, tags, userId);
      }
      setTemplateModalOpen(false);
      setTemplateSourceId(null);
      setTemplatesLoaded(false);
    } catch (err) {
      console.error("Failed to save template:", err);
    } finally {
      setTemplateSaving(false);
    }
  };

  const handleLoadTemplate = async (template: CampaignTemplate) => {
    if (!userId) return;
    const draft = applyTemplate(template);
    await saveDraftToDb(draft, userId);
    router.push(`/campaign/${draft.id}`);
  };

  const handleDeleteTemplate = async (id: string) => {
    await deleteTemplateFromDb(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  // ─── Tab config ──────────────────────────────────────────────────────────────
  const tabs: { id: LibraryTab; label: string; count: number }[] = [
    { id: "drafts", label: "Drafts", count: campaigns.filter((c) => c.status === "draft").length },
    { id: "published", label: "Published", count: campaigns.filter((c) => c.status === "published").length },
    { id: "archived", label: "Archived", count: campaigns.filter((c) => c.status === "archived").length },
    { id: "templates", label: "Templates", count: templates.length },
  ];

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <h1 className="font-heading text-2xl tracking-wide">Campaign Library</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">Manage drafts, published campaigns, and templates</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleNewCampaign} disabled={!userId}>
              <Plus className="h-4 w-4" />
              New Campaign
            </Button>
          </div>
        </div>
      </header>

      {/* Tabs + Search */}
      <div className="border-b border-border bg-card px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex gap-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative px-4 py-3 text-sm font-medium transition-colors
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
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-8 w-52 rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground
                placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-5xl">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tab === "templates" ? (
            /* ───── Templates tab ───── */
            !templatesLoaded ? (
              <div className="flex items-center justify-center py-20">
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
                    onLoad={handleLoadTemplate}
                    onDelete={handleDeleteTemplate}
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
            /* ───── Campaign rows ───── */
            <div className="space-y-2">
              {filteredCampaigns.map((c) => (
                <CampaignRow
                  key={c.id}
                  campaign={c}
                  isLoading={actionLoading === c.id}
                  confirmDelete={confirmDeleteId === c.id}
                  onOpen={handleOpen}
                  onDuplicate={handleDuplicate}
                  onArchive={handleArchive}
                  onUnarchive={handleUnarchive}
                  onDelete={(id) => setConfirmDeleteId(id)}
                  onConfirmDelete={handleDelete}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                  onRelaunch={handleRelaunch}
                  onSaveAsTemplate={handleSaveAsTemplate}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <SaveTemplateModal
        open={templateModalOpen}
        saving={templateSaving}
        onClose={() => { setTemplateModalOpen(false); setTemplateSourceId(null); }}
        onSave={handleSaveTemplateConfirm}
      />

      <NewCampaignModal
        open={newCampaignOpen}
        userId={userId}
        onClose={() => setNewCampaignOpen(false)}
      />
    </div>
  );
}
