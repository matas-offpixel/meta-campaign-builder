"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  BookmarkPlus,
  Clock,
  Copy,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Rocket,
  RotateCcw,
  Search,
  Tag,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SaveTemplateModal } from "@/components/templates/save-template-modal";
import {
  archiveTikTokDraft,
  duplicateTikTokDraft,
  listTikTokDrafts,
  permanentlyDeleteTikTokDraft,
  updateTikTokDraftStatus,
  upsertTikTokDraft,
} from "@/lib/db/tiktok-drafts";
import {
  deleteTikTokTemplateFromDb,
  loadTikTokTemplatesFromDb,
  saveTikTokTemplateToDb,
} from "@/lib/db/tiktok-templates";
import { createClient } from "@/lib/supabase/client";
import { TIKTOK_OBJECTIVE_LABELS } from "@/lib/tiktok-wizard/campaign-setup";
import {
  filterTikTokLibraryDrafts,
  filterTikTokLibraryTemplates,
  startTikTokDraftFromTemplate,
  tikTokLibraryTabCounts,
  TIKTOK_LIBRARY_DELETE_CONFIRM,
  type TikTokLibraryDraftRow,
  type TikTokLibraryTab,
} from "@/lib/tiktok-wizard/library";
import {
  storeTikTokTemplateAccountNotice,
  tikTokTemplateClientLabel,
  type TikTokCampaignTemplate,
} from "@/lib/tiktok-wizard/templates";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

interface NamedRef {
  id: string;
  name: string;
}

interface EventRef extends NamedRef {
  client_id: string;
}

export function TikTokCampaignLibrary({
  userId,
  initialDrafts,
  clientsById,
  eventsById,
}: {
  userId: string;
  initialDrafts: TikTokCampaignDraft[];
  clientsById: Record<string, NamedRef>;
  eventsById: Record<string, EventRef>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TikTokLibraryTab>("drafts");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [updatedFilter, setUpdatedFilter] = useState("");
  const [drafts, setDrafts] = useState(initialDrafts);
  const [templates, setTemplates] = useState<TikTokCampaignTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSourceId, setTemplateSourceId] = useState<string | null>(null);

  const rows: TikTokLibraryDraftRow[] = useMemo(
    () =>
      drafts.map((draft) => ({
        draft,
        clientName: draft.clientId ? (clientsById[draft.clientId]?.name ?? null) : null,
        eventName: draft.eventId ? (eventsById[draft.eventId]?.name ?? null) : null,
      })),
    [drafts, clientsById, eventsById],
  );

  const loadTemplatesList = useCallback(async () => {
    setTemplatesLoaded(false);
    const fetched = await loadTikTokTemplatesFromDb(userId);
    setTemplates(fetched);
    setTemplatesLoaded(true);
  }, [userId]);

  useEffect(() => {
    if (tab !== "templates") setTemplatesLoaded(false);
  }, [tab]);

  useEffect(() => {
    if (tab === "templates" && !templatesLoaded) {
      void loadTemplatesList();
    }
  }, [tab, templatesLoaded, loadTemplatesList]);

  const counts = tikTokLibraryTabCounts(drafts, templates.length);
  const tabs: { id: TikTokLibraryTab; label: string; count: number }[] = [
    { id: "drafts", label: "Drafts", count: counts.drafts },
    { id: "published", label: "Published", count: counts.published },
    { id: "archived", label: "Archived", count: counts.archived },
    { id: "templates", label: "Templates", count: counts.templates },
  ];

  const filteredDrafts =
    tab === "templates"
      ? []
      : filterTikTokLibraryDrafts({
          rows,
          tab,
          search,
          clientId: clientFilter || null,
          eventId: eventFilter || null,
          updated: updatedFilter || null,
        });
  const filteredTemplates = filterTikTokLibraryTemplates(templates, search);

  async function refreshDrafts() {
    const supabase = createClient();
    setDrafts(await listTikTokDrafts(supabase, { userId }));
  }

  const handleOpen = (id: string) => {
    router.push(`/tiktok-campaign/${id}`);
  };

  const handleDuplicate = async (id: string) => {
    setActionLoading(id);
    const supabase = createClient();
    const copy = await duplicateTikTokDraft(supabase, id, userId);
    if (copy) await refreshDrafts();
    setActionLoading(null);
  };

  const handleArchive = async (id: string) => {
    setActionLoading(id);
    const supabase = createClient();
    await archiveTikTokDraft(supabase, id);
    setDrafts((prev) =>
      prev.map((draft) => (draft.id === id ? { ...draft, status: "archived" } : draft)),
    );
    setActionLoading(null);
  };

  const handleUnarchive = async (id: string) => {
    setActionLoading(id);
    const supabase = createClient();
    await updateTikTokDraftStatus(supabase, id, "draft");
    setDrafts((prev) =>
      prev.map((draft) => (draft.id === id ? { ...draft, status: "draft" } : draft)),
    );
    setActionLoading(null);
  };

  const handleDelete = async (id: string) => {
    setActionLoading(id);
    const supabase = createClient();
    await permanentlyDeleteTikTokDraft(supabase, id);
    setDrafts((prev) => prev.filter((draft) => draft.id !== id));
    setConfirmDeleteId(null);
    setActionLoading(null);
  };

  const handleRelaunch = async (id: string) => {
    setActionLoading(id);
    const supabase = createClient();
    const copy = await duplicateTikTokDraft(supabase, id, userId);
    if (copy) router.push(`/tiktok-campaign/${copy.id}`);
    setActionLoading(null);
  };

  const handleSaveAsTemplate = (id: string) => {
    setTemplateSourceId(id);
    setTemplateModalOpen(true);
  };

  const handleSaveTemplateConfirm = async (
    name: string,
    description: string,
    tags: string[],
  ) => {
    if (!templateSourceId) return;
    const source = drafts.find((draft) => draft.id === templateSourceId);
    if (!source) return;
    setTemplateSaving(true);
    try {
      await saveTikTokTemplateToDb(source, name, description, tags, userId);
      setTemplateModalOpen(false);
      setTemplateSourceId(null);
      setTemplatesLoaded(false);
    } finally {
      setTemplateSaving(false);
    }
  };

  const handleLoadTemplate = async (
    template: TikTokCampaignTemplate,
    targetClientId: string,
    targetEventId: string,
  ) => {
    const applied = startTikTokDraftFromTemplate(
      template,
      crypto.randomUUID(),
      targetClientId,
      targetEventId,
    );
    const draft = applied.draft;
    storeTikTokTemplateAccountNotice(draft.id, applied.accountNotice);
    const supabase = createClient();
    await upsertTikTokDraft(supabase, draft.id, { ...draft, userId });
    router.push(`/tiktok-campaign/${draft.id}`);
  };

  const handleDeleteTemplate = async (id: string) => {
    await deleteTikTokTemplateFromDb(id);
    setTemplates((prev) => prev.filter((template) => template.id !== id));
  };

  const clientOptions = Object.values(clientsById);
  const eventOptions = Object.values(eventsById).filter(
    (event) => !clientFilter || event.client_id === clientFilter,
  );

  return (
    <div className="space-y-4">
      <div className="border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-0">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`relative px-4 py-3 text-sm font-medium transition-colors ${
                  tab === item.id
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
                {item.count > 0 && (
                  <span className="ml-1.5 text-[10px] font-semibold text-muted-foreground">
                    {item.count}
                  </span>
                )}
                {tab === item.id && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-foreground" />
                )}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search…"
              className="h-8 w-52 rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      {tab !== "templates" && (
        <div className="grid gap-3 md:grid-cols-3">
          <FilterSelect
            label="Client"
            value={clientFilter}
            onChange={setClientFilter}
            options={clientOptions.map((client) => ({
              value: client.id,
              label: client.name,
            }))}
          />
          <FilterSelect
            label="Event"
            value={eventFilter}
            onChange={setEventFilter}
            options={eventOptions.map((event) => ({
              value: event.id,
              label: event.name,
            }))}
          />
          <FilterSelect
            label="Updated"
            value={updatedFilter}
            onChange={setUpdatedFilter}
            options={[
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
              { value: "older", label: "Older" },
            ]}
          />
        </div>
      )}

      {tab === "templates" ? (
        !templatesLoaded ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredTemplates.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No templates yet"
            description="Save a TikTok campaign as a template to reuse it later."
          />
        ) : (
          <div className="space-y-2">
            {filteredTemplates.map((template) => (
              <TemplateRow
                key={template.id}
                template={template}
                clientsById={clientsById}
                eventsById={eventsById}
                onLoad={(next, clientId, eventId) =>
                  void handleLoadTemplate(next, clientId, eventId)
                }
                onDelete={(id) => void handleDeleteTemplate(id)}
              />
            ))}
          </div>
        )
      ) : filteredDrafts.length === 0 ? (
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
              ? "Start a new TikTok campaign to get going."
              : tab === "published"
                ? "Published TikTok campaigns will appear here."
                : "Archived TikTok campaigns will appear here."
          }
        />
      ) : (
        <div className="space-y-2">
          {filteredDrafts.map((item) => (
            <CampaignRow
              key={item.draft.id}
              row={item}
              isLoading={actionLoading === item.draft.id}
              confirmDelete={confirmDeleteId === item.draft.id}
              onOpen={handleOpen}
              onDuplicate={(id) => void handleDuplicate(id)}
              onArchive={(id) => void handleArchive(id)}
              onUnarchive={(id) => void handleUnarchive(id)}
              onDelete={setConfirmDeleteId}
              onConfirmDelete={(id) => void handleDelete(id)}
              onCancelDelete={() => setConfirmDeleteId(null)}
              onRelaunch={(id) => void handleRelaunch(id)}
              onSaveAsTemplate={handleSaveAsTemplate}
            />
          ))}
        </div>
      )}

      <SaveTemplateModal
        open={templateModalOpen}
        saving={templateSaving}
        onClose={() => {
          setTemplateModalOpen(false);
          setTemplateSourceId(null);
        }}
        onSave={(name, description, tags) => {
          void handleSaveTemplateConfirm(name, description, tags);
        }}
      />
    </div>
  );
}

function CampaignRow({
  row,
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
}: {
  row: TikTokLibraryDraftRow;
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
}) {
  const draft = row.draft;
  const objective = draft.campaignSetup.objective
    ? TIKTOK_OBJECTIVE_LABELS[draft.campaignSetup.objective]
    : "—";

  return (
    <div
      className={`group rounded-md border border-border bg-card p-4 transition-colors hover:border-border-strong ${
        isLoading ? "pointer-events-none opacity-50" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">
              {draft.campaignSetup.campaignName || "Untitled TikTok draft"}
            </p>
            <StatusBadge status={draft.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="font-medium">{objective}</span>
            {row.clientName && <span>{row.clientName}</span>}
            {row.eventName && <span>{row.eventName}</span>}
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {formatDate(draft.updatedAt)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {confirmDelete ? (
            <div className="max-w-sm space-y-2">
              <p className="text-xs text-muted-foreground">
                {TIKTOK_LIBRARY_DELETE_CONFIRM}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onConfirmDelete(draft.id)}
                >
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancelDelete}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button size="sm" onClick={() => onOpen(draft.id)}>
                Open
              </Button>
              {draft.status === "published" && (
                <Button size="sm" variant="outline" onClick={() => onRelaunch(draft.id)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Relaunch</span>
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onDuplicate(draft.id)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onSaveAsTemplate(draft.id)}>
                <BookmarkPlus className="h-3.5 w-3.5" />
              </Button>
              {draft.status === "archived" ? (
                <Button size="sm" variant="ghost" onClick={() => onUnarchive(draft.id)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => onArchive(draft.id)}>
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onDelete(draft.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateRow({
  template,
  clientsById,
  eventsById,
  onLoad,
  onDelete,
}: {
  template: TikTokCampaignTemplate;
  clientsById: Record<string, NamedRef>;
  eventsById: Record<string, EventRef>;
  onLoad: (
    template: TikTokCampaignTemplate,
    clientId: string,
    eventId: string,
  ) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [picking, setPicking] = useState(false);
  const snapshotClientId = template.snapshot.clientId ?? "";
  const snapshotEventId = template.snapshot.eventId ?? "";
  const [targetClientId, setTargetClientId] = useState(snapshotClientId);
  const [targetEventId, setTargetEventId] = useState(snapshotEventId);
  const objective = template.snapshot.campaignSetup.objective
    ? TIKTOK_OBJECTIVE_LABELS[template.snapshot.campaignSetup.objective]
    : "—";
  const groupCount = template.snapshot.audiences.interestGroups.length;
  const creativeCount = template.snapshot.creatives.items.length;
  const savedClientName = tikTokTemplateClientLabel(
    template.snapshot.clientId,
    template.snapshot.clientId
      ? (clientsById[template.snapshot.clientId]?.name ?? null)
      : null,
  );
  const clientOptions = Object.values(clientsById);
  const eventOptions = Object.values(eventsById).filter(
    (event) => !targetClientId || event.client_id === targetClientId,
  );
  const canCreate = Boolean(targetClientId && targetEventId);

  return (
    <div className="group rounded-md border border-border bg-card p-4 transition-colors hover:border-border-strong">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{template.name}</p>
          {template.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {template.description}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{objective}</span>
            <span>Saved for {savedClientName}</span>
            <span>
              {groupCount} interest group{groupCount !== 1 ? "s" : ""}
            </span>
            <span>
              {creativeCount} creative{creativeCount !== 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {formatDate(template.createdAt)}
            </span>
          </div>
          {template.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {template.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  <Tag className="h-2 w-2" />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {confirmDel ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  onDelete(template.id);
                  setConfirmDel(false);
                }}
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>
                Cancel
              </Button>
            </div>
          ) : picking ? (
            <div className="w-64 space-y-2">
              <p className="text-xs text-muted-foreground">
                Pick a client and event before creating the draft. This template
                was saved for {savedClientName}.
              </p>
              <FilterSelect
                label="Client"
                value={targetClientId}
                onChange={(next) => {
                  setTargetClientId(next);
                  setTargetEventId("");
                }}
                emptyLabel="Select a client"
                options={clientOptions.map((client) => ({
                  value: client.id,
                  label: client.name,
                }))}
              />
              <FilterSelect
                label="Event"
                value={targetEventId}
                onChange={setTargetEventId}
                emptyLabel="Select an event"
                options={eventOptions.map((event) => ({
                  value: event.id,
                  label: event.name,
                }))}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={!canCreate}
                  onClick={() => {
                    if (!canCreate) return;
                    onLoad(template, targetClientId, targetEventId);
                    setPicking(false);
                  }}
                >
                  Create draft
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button size="sm" onClick={() => setPicking(true)}>
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

function StatusBadge({ status }: { status: TikTokCampaignDraft["status"] }) {
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

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="py-16 text-center">
      <Icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      {title === "No drafts" && (
        <div className="mt-4 flex justify-center">
          <Link href="/tiktok/new">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              New TikTok campaign
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  emptyLabel = "All",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  emptyLabel?: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm"
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

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
