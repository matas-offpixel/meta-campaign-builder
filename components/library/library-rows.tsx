"use client";

import { useState, type ElementType } from "react";
import {
  Archive,
  BookmarkPlus,
  Clock,
  Copy,
  FolderOpen,
  RotateCcw,
  Tag,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricChip } from "@/components/viz/metric-chip";
import { formatLibraryDate, formatLibraryRelativeDate } from "@/lib/library/format-date";
import type { CampaignDraft, CampaignListItem, CampaignTemplate } from "@/lib/types";

export { formatLibraryDate, formatLibraryRelativeDate };

export type LibraryTab = "drafts" | "published" | "archived" | "templates";

export const OBJECTIVE_LABELS: Record<string, string> = {
  purchase: "Purchase",
  registration: "Registration",
  traffic: "Traffic",
  awareness: "Awareness",
  engagement: "Engagement",
};

export function filterLibraryCampaigns(
  campaigns: CampaignListItem[],
  tab: Exclude<LibraryTab, "templates">,
  search: string,
): CampaignListItem[] {
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
}

export function filterLibraryTemplates(
  templates: CampaignTemplate[],
  search: string,
): CampaignTemplate[] {
  if (!search.trim()) return templates;
  const q = search.toLowerCase();
  return templates.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.toLowerCase().includes(q)),
  );
}

export function LibraryEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="py-16 text-center">
      <Icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export function StatusBadge({ status }: { status: CampaignDraft["status"] }) {
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

export interface CampaignRowProps {
  campaign: CampaignListItem;
  isLoading: boolean;
  confirmDelete?: boolean;
  variant?: "manage" | "pick";
  onOpen?: (id: string) => void;
  onPick?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  onConfirmDelete?: (id: string) => void;
  onCancelDelete?: () => void;
  onRelaunch?: (id: string) => void;
  onSaveAsTemplate?: (id: string) => void;
}

export function CampaignRow({
  campaign: c,
  isLoading,
  confirmDelete = false,
  variant = "manage",
  onOpen,
  onPick,
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
  const objectiveMark = objective.slice(0, 1).toUpperCase();

  return (
    <div
      className={`group rounded-md border border-border bg-card p-4 transition-colors hover:border-border-strong
        ${isLoading ? "opacity-50 pointer-events-none" : ""}`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">
              {c.name || "Untitled Campaign"}
            </p>
            <StatusBadge status={c.status} />
          </div>
          {variant === "pick" ? (
            <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold"
                aria-label={objective}
                title={objective}
              >
                {objectiveMark}
              </span>
              {c.adAccountId ? (
                <MetricChip label={c.adAccountId} className="max-w-[12rem]">
                  <span className="truncate">{c.adAccountId}</span>
                </MetricChip>
              ) : null}
              <span className="inline-flex shrink-0 items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                {formatLibraryRelativeDate(c.updatedAt)}
              </span>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-medium">{objective}</span>
              {c.adAccountId && <span>Account: {c.adAccountId}</span>}
              <span className="flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                {formatLibraryDate(c.updatedAt)}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {variant === "pick" ? (
            <Button size="sm" onClick={() => onPick?.(c.id)}>
              Use
            </Button>
          ) : confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <Button size="sm" variant="destructive" onClick={() => onConfirmDelete?.(c.id)}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancelDelete}>
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <Button size="sm" onClick={() => onOpen?.(c.id)}>
                Open
              </Button>

              {c.status === "published" && (
                <Button size="sm" variant="outline" onClick={() => onRelaunch?.(c.id)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Relaunch</span>
                </Button>
              )}

              <Button size="sm" variant="ghost" onClick={() => onDuplicate?.(c.id)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>

              <Button size="sm" variant="ghost" onClick={() => onSaveAsTemplate?.(c.id)}>
                <BookmarkPlus className="h-3.5 w-3.5" />
              </Button>

              {c.status === "archived" ? (
                <Button size="sm" variant="ghost" onClick={() => onUnarchive?.(c.id)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => onArchive?.(c.id)}>
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              )}

              <Button size="sm" variant="ghost" onClick={() => onDelete?.(c.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function TemplateRow({
  template: t,
  variant = "manage",
  onLoad,
  onPick,
  onDelete,
}: {
  template: CampaignTemplate;
  variant?: "manage" | "pick";
  onLoad?: (t: CampaignTemplate) => void;
  onPick?: (t: CampaignTemplate) => void;
  onDelete?: (id: string) => void;
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
              {formatLibraryDate(t.createdAt)}
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
          {variant === "pick" ? (
            <Button size="sm" onClick={() => onPick?.(t)}>
              <FolderOpen className="h-3.5 w-3.5" />
              Use Template
            </Button>
          ) : confirmDel ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <Button size="sm" variant="destructive" onClick={() => { onDelete?.(t.id); setConfirmDel(false); }}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <Button size="sm" onClick={() => onLoad?.(t)}>
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
