"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, FileText, FolderOpen, Plus, Rocket, Search } from "lucide-react";

import {
  filterLibraryPlans,
  LibraryEmptyState,
  PlanRow,
  PlanTemplateRow,
  type LibraryTab,
  type PlanLibraryItem,
} from "@/components/library/library-rows";
import { SaveTemplateModal } from "@/components/templates/save-template-modal";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { countPlanLibraryTabs } from "@/lib/plan/library";
import type { CampaignPlanTemplate } from "@/lib/plan/library";
import {
  planEventPickerRows,
  todayIsoDate,
  visiblePlanEvents,
  type PlanEventOption,
} from "@/lib/plan/event-picker";

export function PlanLibrary({
  plans,
  events,
  templates: initialTemplates,
  tableMissing,
  templatesMissing,
}: {
  plans: PlanLibraryItem[];
  events: PlanEventOption[];
  templates: CampaignPlanTemplate[];
  tableMissing: boolean;
  templatesMissing: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<LibraryTab>("drafts");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState(plans);
  const [templates, setTemplates] = useState(initialTemplates);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateSourceId, setTemplateSourceId] = useState<string | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [eventPick, setEventPick] = useState<{
    kind: "duplicate" | "from-template";
    sourceId: string;
  } | null>(null);
  const [pickedEventId, setPickedEventId] = useState("");

  const counts = countPlanLibraryTabs(items, templates.length);
  const tabs: { id: LibraryTab; label: string; count: number }[] = [
    { id: "drafts", label: "Drafts", count: counts.drafts },
    { id: "published", label: "Published", count: counts.published },
    { id: "archived", label: "Archived", count: counts.archived },
    { id: "templates", label: "Templates", count: counts.templates },
  ];

  const filteredPlans = useMemo(() => {
    if (tab === "templates") return [];
    return filterLibraryPlans(items, tab, search);
  }, [items, tab, search]);

  const filteredTemplates = useMemo(() => {
    if (!search.trim()) return templates;
    const q = search.toLowerCase();
    return templates.filter(
      (template) =>
        template.name.toLowerCase().includes(q) ||
        template.description.toLowerCase().includes(q) ||
        template.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [templates, search]);

  const pickerOptions = useMemo(
    () =>
      planEventPickerRows(
        visiblePlanEvents(events, {
          today: todayIsoDate(),
          showPast: true,
          selectedId: pickedEventId,
        }),
      ).map((row) => ({
        value: row.id,
        label: row.label,
        sublabel: row.sublabel || undefined,
        keywords: row.keywords || undefined,
      })),
    [events, pickedEventId],
  );

  function openPlan(id: string) {
    router.push(`/plan/${id}`);
  }

  async function handleSaveTemplate(name: string, description: string, tags: string[]) {
    if (!templateSourceId) return;
    setTemplateSaving(true);
    try {
      const res = await fetch("/api/plan/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: templateSourceId, name, description, tags }),
      });
      const json = (await res.json()) as { ok?: boolean; template?: CampaignPlanTemplate };
      if (res.ok && json.ok && json.template) {
        setTemplates((current) => [json.template!, ...current]);
        setTemplateModalOpen(false);
        setTemplateSourceId(null);
      }
    } finally {
      setTemplateSaving(false);
    }
  }

  async function confirmEventPick() {
    if (!eventPick || !pickedEventId) return;
    setBusyId(eventPick.sourceId);
    try {
      if (eventPick.kind === "duplicate") {
        const res = await fetch(`/api/plan/${encodeURIComponent(eventPick.sourceId)}/duplicate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: pickedEventId }),
        });
        const json = (await res.json()) as { ok?: boolean; plan?: { id: string } };
        if (res.ok && json.ok && json.plan) router.push(`/plan/${json.plan.id}`);
      } else {
        const res = await fetch("/api/plan/from-template", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: eventPick.sourceId, eventId: pickedEventId }),
        });
        const json = (await res.json()) as { ok?: boolean; plan?: { id: string } };
        if (res.ok && json.ok && json.plan) router.push(`/plan/${json.plan.id}`);
      }
    } finally {
      setBusyId(null);
      setEventPick(null);
      setPickedEventId("");
    }
  }

  async function handleUnarchive(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/plan/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "unarchive" }),
      });
      const json = (await res.json()) as { ok?: boolean; status?: PlanLibraryItem["status"] };
      if (res.ok && json.ok && json.status) {
        setItems((current) =>
          current.map((plan) => (plan.id === id ? { ...plan, status: json.status! } : plan)),
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteTemplate(id: string) {
    const res = await fetch(`/api/plan/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = (await res.json()) as { ok?: boolean };
    if (res.ok && json.ok) setTemplates((current) => current.filter((template) => template.id !== id));
  }

  if (tableMissing) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
        No plans table yet. Migration 157 has not been applied.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex gap-0">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`relative px-4 py-3 text-sm font-medium transition-colors
                ${tab === item.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
              {item.count > 0 ? (
                <span className="ml-1.5 text-[10px] font-semibold text-muted-foreground">{item.count}</span>
              ) : null}
              {tab === item.id ? (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-foreground" />
              ) : null}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-2">
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
          <Button size="sm" variant="outline" onClick={() => setTab("templates")}>
            New plan from template
          </Button>
          <Button size="sm" onClick={() => router.push("/plan/new")}>
            <Plus className="h-3.5 w-3.5" />
            New plan
          </Button>
        </div>
      </div>

      <div className="pt-4">
        {tab === "templates" ? (
          templatesMissing ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
              Plan templates need migration 163.
            </p>
          ) : filteredTemplates.length === 0 ? (
            <LibraryEmptyState
              icon={FolderOpen}
              title="No plan templates yet"
              description="Save a plan as a template to reuse the shape on a new event."
            />
          ) : (
            <div className="space-y-2">
              {filteredTemplates.map((template) => (
                <PlanTemplateRow
                  key={template.id}
                  template={template}
                  onUse={(row) => setEventPick({ kind: "from-template", sourceId: row.id })}
                  onDelete={handleDeleteTemplate}
                />
              ))}
            </div>
          )
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
            No plans yet.
          </p>
        ) : filteredPlans.length === 0 ? (
          <LibraryEmptyState
            icon={tab === "drafts" ? FileText : tab === "published" ? Rocket : Archive}
            title={
              tab === "drafts"
                ? "No drafts"
                : tab === "published"
                  ? "No published plans"
                  : "No archived plans"
            }
            description={
              tab === "drafts"
                ? "Start a new plan to get going."
                : tab === "published"
                  ? "Live and live-partial plans will appear here."
                  : "Archived plans will appear here."
            }
          />
        ) : (
          <div className="space-y-2">
            {filteredPlans.map((plan) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                /* PlanDeleteAction stays on the row — #863 delete/archive gating unchanged. */
                isLoading={busyId === plan.id}
                onOpen={openPlan}
                onDuplicate={(id) => setEventPick({ kind: "duplicate", sourceId: id })}
                onSaveAsTemplate={(id) => {
                  setTemplateSourceId(id);
                  setTemplateModalOpen(true);
                }}
                onUnarchive={handleUnarchive}
                onDeleted={() => setItems((current) => current.filter((row) => row.id !== plan.id))}
              />
            ))}
          </div>
        )}
      </div>

      <SaveTemplateModal
        open={templateModalOpen}
        saving={templateSaving}
        onClose={() => {
          setTemplateModalOpen(false);
          setTemplateSourceId(null);
        }}
        onSave={handleSaveTemplate}
      />

      <Dialog
        open={eventPick != null}
        onClose={() => {
          setEventPick(null);
          setPickedEventId("");
        }}
      >
        <DialogContent>
          <DialogHeader
            onClose={() => {
              setEventPick(null);
              setPickedEventId("");
            }}
          >
            <DialogTitle>
              {eventPick?.kind === "duplicate" ? "Duplicate plan" : "New plan from template"}
            </DialogTitle>
            <DialogDescription>
              Pick the event. Identities re-resolve from that client. Launched campaigns stay put.
            </DialogDescription>
          </DialogHeader>
          <Combobox
            label="Event"
            value={pickedEventId}
            onChange={setPickedEventId}
            options={pickerOptions}
            placeholder="Select an event"
            emptyText="No matching events"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEventPick(null);
                setPickedEventId("");
              }}
            >
              Cancel
            </Button>
            <Button type="button" disabled={!pickedEventId || !!busyId} onClick={() => void confirmEventPick()}>
              {eventPick?.kind === "duplicate" ? "Duplicate" : "Create plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
