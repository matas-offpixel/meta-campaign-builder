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
  LogOut,
  Copy,
  BookmarkPlus,
  Trash2,
  RotateCcw,
  FolderOpen,
  Clock,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { createDefaultDraft } from "@/lib/campaign-defaults";
import { saveDraftToDb, loadCampaignList, duplicateCampaign, deleteCampaign, updateCampaignStatus } from "@/lib/db/drafts";
import { loadTemplatesFromDb, saveTemplateToDb, deleteTemplateFromDb } from "@/lib/db/templates";
import { applyTemplate } from "@/lib/templates";
import { SaveTemplateModal } from "@/components/templates/save-template-modal";
import type { CampaignListItem, CampaignDraft, CampaignTemplate } from "@/lib/types";

type LibraryTab = "drafts" | "published" | "archived" | "templates";

const OBJECTIVE_LABELS: Record<string, string> = {
  purchase: "Purchase",
  registration: "Registration",
  traffic: "Traffic",
  awareness: "Awareness",
  engagement: "Engagement",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function EmptyState({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="py-16 text-center">
      <Icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

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

  useEffect(() => {
    if (tab === "templates" && !templatesLoaded && userId) {
      loadTemplatesList();
    }
  }, [tab, templatesLoaded, userId, loadTemplatesList]);

  // ─── Filtered lists ──────────────────────────────────────────────────────────
  const filteredCampaigns = useMemo(() => {
    const statusFilter = tab === "drafts" ? "draft" : tab === "published" ? "published" : "archived";
    let items = campaigns.filter((c) => c.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (c) =>
          (c.name ?? "").toLowerCase().includes(q) ||
          (c.objective ?? "").toLowerCase().includes(q),
      );
    }
    return items;
  }, [campaigns, tab, search]);

  const filteredTemplates = useMemo(() => {
    if (!search.trim()) return templates;
    const q = search.toLowerCase();
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [templates, search]);

  // ─── Actions ─────────────────────────────────────────────────────────────────
  const handleNewCampaign = async () => {
    if (!userId) return;
    const draft = createDefaultDraft();
    await saveDraftToDb(draft, userId);
    router.push(`/campaign/${draft.id}`);
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

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
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
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground
                hover:text-foreground hover:bg-muted transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Log out</span>
            </button>
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
              <EmptyState
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
            <EmptyState
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
    </div>
  );
}

// ─── Campaign Row ────────────────────────────────────────────────────────────

interface CampaignRowProps {
  campaign: CampaignListItem;
  isLoading: boolean;
  confirmDelete: boolean;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  onRelaunch: (id: string) => void;
  onSaveAsTemplate: (id: string) => void;
}

function CampaignRow({
  campaign: c,
  isLoading,
  confirmDelete,
  onOpen,
  onDuplicate,
  onArchive,
  onUnarchive,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onRelaunch,
  onSaveAsTemplate,
}: CampaignRowProps) {
  const objective = OBJECTIVE_LABELS[c.objective ?? ""] ?? c.objective ?? "—";

  return (
    <div
      className={`group rounded-md border border-border bg-card p-4 transition-colors hover:border-border-strong
        ${isLoading ? "opacity-50 pointer-events-none" : ""}`}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">
              {c.name || "Untitled Campaign"}
            </p>
            <StatusBadge status={c.status} />
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="font-medium">{objective}</span>
            {c.adAccountId && <span>Account: {c.adAccountId}</span>}
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {formatDate(c.updatedAt)}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <Button size="sm" variant="destructive" onClick={() => onConfirmDelete(c.id)}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancelDelete}>
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <Button size="sm" onClick={() => onOpen(c.id)}>
                Open
              </Button>

              {c.status === "published" && (
                <Button size="sm" variant="outline" onClick={() => onRelaunch(c.id)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Relaunch</span>
                </Button>
              )}

              <Button size="sm" variant="ghost" onClick={() => onDuplicate(c.id)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>

              <Button size="sm" variant="ghost" onClick={() => onSaveAsTemplate(c.id)}>
                <BookmarkPlus className="h-3.5 w-3.5" />
              </Button>

              {c.status === "archived" ? (
                <Button size="sm" variant="ghost" onClick={() => onUnarchive(c.id)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => onArchive(c.id)}>
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              )}

              <Button size="sm" variant="ghost" onClick={() => onDelete(c.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Template Row ────────────────────────────────────────────────────────────

function TemplateRow({
  template: t,
  onLoad,
  onDelete,
}: {
  template: CampaignTemplate;
  onLoad: (t: CampaignTemplate) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const obj = OBJECTIVE_LABELS[t.snapshot.settings.objective] ?? t.snapshot.settings.objective;
  const audienceCount =
    t.snapshot.audiences.pageGroups.length +
    t.snapshot.audiences.customAudienceGroups.length +
    t.snapshot.audiences.interestGroups.length;
  const creativeCount = t.snapshot.creatives.length;

  return (
    <div className="group rounded-md border border-border bg-card p-4 transition-colors hover:border-border-strong">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
          {t.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t.description}</p>
          )}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{obj}</span>
            <span>{audienceCount} audience group{audienceCount !== 1 ? "s" : ""}</span>
            <span>{creativeCount} creative{creativeCount !== 1 ? "s" : ""}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {formatDate(t.createdAt)}
            </span>
          </div>
          {t.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {t.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-muted-foreground"
                >
                  <Tag className="h-2 w-2" />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {confirmDel ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <Button size="sm" variant="destructive" onClick={() => { onDelete(t.id); setConfirmDel(false); }}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <Button size="sm" onClick={() => onLoad(t)}>
                <FolderOpen className="h-3.5 w-3.5" />
                Use Template
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDel(true)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CampaignDraft["status"] }) {
  const config = {
    draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
    published: { label: "Published", cls: "bg-foreground/10 text-foreground" },
    archived: { label: "Archived", cls: "bg-muted text-muted-foreground" },
  };
  const { label, cls } = config[status] ?? config.draft;

  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}
