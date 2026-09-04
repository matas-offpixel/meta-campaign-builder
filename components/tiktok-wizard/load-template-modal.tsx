"use client";

import { useMemo, useState } from "react";
import { Clock, FileText, Search, Tag, Trash2, X } from "lucide-react";

import { Datum } from "@/components/steps/step-surface";
import { Button } from "@/components/ui/button";
import {
  tikTokTemplateClientLabel,
  type TikTokCampaignTemplate,
} from "@/lib/tiktok-wizard/templates";

interface TikTokLoadTemplateModalProps {
  open: boolean;
  templates: TikTokCampaignTemplate[];
  clientNameById?: Record<string, string>;
  loading?: boolean;
  deletingId?: string | null;
  onClose: () => void;
  onSelect: (template: TikTokCampaignTemplate) => void;
  onDelete: (id: string) => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function TikTokLoadTemplateModal(props: TikTokLoadTemplateModalProps) {
  if (!props.open) return null;
  return <TikTokLoadTemplateModalBody {...props} />;
}

function TikTokLoadTemplateModalBody({
  templates,
  clientNameById = {},
  loading = false,
  deletingId = null,
  onClose,
  onSelect,
  onDelete,
}: TikTokLoadTemplateModalProps) {
  const [search, setSearch] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return templates;
    const q = search.toLowerCase();
    return templates.filter(
      (template) =>
        template.name.toLowerCase().includes(q) ||
        template.description.toLowerCase().includes(q) ||
        template.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [templates, search]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative z-10 flex w-full max-w-lg flex-col rounded-md border border-border bg-background shadow-md"
        style={{ maxHeight: "80vh" }}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-heading text-xl tracking-wide">Load Template</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pb-2 pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search templates..."
              className="h-9 w-full rounded-md border border-border-strong bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {loading ? (
            <div className="mt-2 space-y-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="animate-pulse rounded-md border border-border bg-card p-4">
                  <div className="mb-2 h-3 w-40 rounded bg-muted" />
                  <div className="h-2.5 w-56 rounded bg-muted/60" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
              <Datum className="text-sm text-muted-foreground">
                {templates.length === 0
                  ? "No templates saved yet."
                  : "No templates match your search."}
              </Datum>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {filtered.map((template) => {
                const isDeleting = deletingId === template.id;
                const groupCount = template.snapshot.audiences.interestGroups.length;
                const creativeCount = template.snapshot.creatives.items.length;
                return (
                  <div
                    key={template.id}
                    className={`rounded-md border border-border bg-card p-4 transition-colors hover:border-border-strong ${isDeleting ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <Datum className="truncate text-sm font-medium text-foreground">
                          {template.name}
                        </Datum>
                        {template.description && (
                          <Datum className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {template.description}
                          </Datum>
                        )}
                        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {template.snapshot.campaignSetup.objective ?? "No objective"}
                          </span>
                          <span>
                            Saved for{" "}
                            {tikTokTemplateClientLabel(
                              template.snapshot.clientId,
                              template.snapshot.clientId
                                ? (clientNameById[template.snapshot.clientId] ?? null)
                                : null,
                            )}
                          </span>
                          <span>
                            {groupCount} group{groupCount !== 1 ? "s" : ""}
                          </span>
                          <span>
                            {creativeCount} creative{creativeCount !== 1 ? "s" : ""}
                          </span>
                        </div>
                        {template.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
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
                        <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />
                          {formatDate(template.createdAt)}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => onSelect(template)}
                          disabled={isDeleting}
                        >
                          Load
                        </Button>
                        {confirmId === template.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                onDelete(template.id);
                                setConfirmId(null);
                              }}
                              className="text-[10px] font-medium text-destructive hover:underline"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmId(null)}
                              className="text-[10px] text-muted-foreground hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmId(template.id)}
                            disabled={isDeleting}
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-border px-6 py-3">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
