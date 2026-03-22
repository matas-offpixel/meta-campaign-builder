"use client";

import { useState, useMemo, useEffect } from "react";
import { X, Search, FileText, Tag, Trash2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CampaignTemplate } from "@/lib/types";

interface LoadTemplateModalProps {
  open: boolean;
  templates: CampaignTemplate[];
  loading?: boolean;
  deletingId?: string | null;
  onClose: () => void;
  onSelect: (template: CampaignTemplate) => void;
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

const OBJECTIVE_LABELS: Record<string, string> = {
  purchase: "Purchase",
  registration: "Registration",
  traffic: "Traffic",
  awareness: "Awareness",
  engagement: "Engagement",
};

export function LoadTemplateModal({
  open,
  templates,
  loading = false,
  deletingId = null,
  onClose,
  onSelect,
  onDelete,
}: LoadTemplateModalProps) {
  const [search, setSearch] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSearch("");
      setConfirmId(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return templates;
    const q = search.toLowerCase();
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [templates, search]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-lg flex-col rounded-md border border-border bg-background shadow-md"
        style={{ maxHeight: "80vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-heading text-xl tracking-wide">Load Template</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pt-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="h-9 w-full rounded-md border border-border-strong bg-background pl-9 pr-3 text-sm text-foreground
                placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {loading ? (
            <div className="space-y-2 mt-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="rounded-md border border-border bg-card p-4 animate-pulse">
                  <div className="h-3 w-40 rounded bg-muted mb-2" />
                  <div className="h-2.5 w-56 rounded bg-muted/60" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {templates.length === 0 ? "No templates saved yet." : "No templates match your search."}
              </p>
            </div>
          ) : (
            <div className="space-y-2 mt-2">
              {filtered.map((t) => {
                const obj = OBJECTIVE_LABELS[t.snapshot.settings.objective] ?? t.snapshot.settings.objective;
                const audienceCount =
                  t.snapshot.audiences.pageGroups.length +
                  t.snapshot.audiences.customAudienceGroups.length +
                  t.snapshot.audiences.interestGroups.length;
                const creativeCount = t.snapshot.creatives.length;
                const ruleCount = t.snapshot.optimisationStrategy?.rules?.filter((r) => r.enabled).length ?? 0;
                const isDeleting = deletingId === t.id;

                return (
                  <div
                    key={t.id}
                    className={`group rounded-md border border-border bg-card p-4 transition-colors hover:border-border-strong ${isDeleting ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                        {t.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{obj}</span>
                          <span>{audienceCount} audience group{audienceCount !== 1 ? "s" : ""}</span>
                          <span>{creativeCount} creative{creativeCount !== 1 ? "s" : ""}</span>
                          {ruleCount > 0 && <span>{ruleCount} rule{ruleCount !== 1 ? "s" : ""}</span>}
                        </div>
                        {t.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
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
                        <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />
                          {formatDate(t.createdAt)}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <Button size="sm" onClick={() => onSelect(t)} disabled={isDeleting}>
                          Load
                        </Button>
                        {confirmId === t.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => { onDelete(t.id); setConfirmId(null); }}
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
                            onClick={() => setConfirmId(t.id)}
                            disabled={isDeleting}
                            className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all disabled:pointer-events-none"
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

        {/* Footer */}
        <div className="border-t border-border px-6 py-3 flex justify-end">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
