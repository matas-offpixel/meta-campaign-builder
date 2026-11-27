"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { createTemplateAudiences, loadAudienceTemplates, saveTemplatePages, type AudienceTemplatesPayload } from "@/lib/actions/audience-templates";
import type { AudienceSettings, TemplateVideoPick } from "@/lib/types";
import type { AudienceTemplate, TemplateItem } from "@/lib/audience-templates/resolve";
import { fw, tw } from "@/lib/audience-templates/words";

import { AudienceTemplatesPanel } from "./audience-templates-panel";

/**
 * R6's own tab beside the Audiences tab (record RC5: "its own tab,
 * 'Audience templates' with a BETA chip, beside 'Audiences'. The Audiences
 * tab and its flow don't change.").
 *
 * `children` is the existing Audiences tab, passed through untouched. With
 * no templates for the draft's client (every client but Electric today,
 * and Electric until the seed is applied) there is no tab row at all: the
 * drawer renders `children` exactly as before.
 *
 * "Add to this draft" hands the next audiences to `onAddToDraft`, which the
 * drawer wires to its own updater; the tab never imports the draft's
 * updaters. "Create" goes through createTemplateAudiences, then reloads.
 */

export type AudiencesTab = "audiences" | "templates";

/** The tab row shows only when there is a template to show. */
export function showsTemplatesTab(data: AudienceTemplatesPayload | null): data is AudienceTemplatesPayload {
  return Boolean(data && data.templates.length > 0);
}

export function AudiencesTabRow({ active, onChange }: { active: AudiencesTab; onChange?: (tab: AudiencesTab) => void }) {
  const tab = (id: AudiencesTab, label: ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={active === id}
      onClick={() => onChange?.(id)}
      className={`px-3.5 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${
        active === id ? "text-foreground shadow-[inset_0_-2px_0_currentColor]" : "text-muted-foreground"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div role="tablist" className="mb-3 flex gap-0.5 border-b border-border-strong">
      {tab("audiences", fw("frame.tab.audiences"))}
      {tab(
        "templates",
        <>
          {tw("templates.tab")}
          <span className="ml-1.5 rounded-lg border border-warning px-1.5 py-px align-[1px] text-[8px] text-warning">{tw("templates.beta")}</span>
        </>,
      )}
    </div>
  );
}

export function AudiencesTabSwitch({
  clientId,
  adAccountId,
  pixelId,
  audiences,
  draftName,
  onAddToDraft,
  eventId,
  eventCode,
  videoPicks,
  onVideoPicks,
  children,
}: {
  clientId: string | null | undefined;
  adAccountId: string | null | undefined;
  pixelId: string | null | undefined;
  /** The draft's audiences and name, for "Add to this draft". Without them Add stays off. */
  audiences?: AudienceSettings;
  draftName?: string;
  onAddToDraft?: (next: AudienceSettings) => void;
  /** The draft's event, and its picked videos for template video-viewer items (the drawer keeps them on the draft). */
  eventId?: string | null;
  eventCode?: string | null;
  videoPicks?: TemplateVideoPick[];
  onVideoPicks?: (next: TemplateVideoPick[]) => void;
  children: ReactNode;
}) {
  const [data, setData] = useState<AudienceTemplatesPayload | null>(null);
  const [tab, setTab] = useState<AudiencesTab>("audiences");

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    loadAudienceTemplates({ clientId, adAccountId, pixelId }).then(
      (next) => {
        if (live) setData(next);
      },
      () => {
        if (live) setData(null);
      },
    );
    return () => {
      live = false;
    };
  }, [clientId, adAccountId, pixelId, version]);

  const onSave = useCallback(
    async (template: AudienceTemplate, pending: TemplateItem[]) => {
      if (!template.id) return false;
      const res = await saveTemplatePages(template.id, pending);
      if (!res.ok) return false;
      setVersion((v) => v + 1);
      return true;
    },
    [],
  );

  const onCreate = useCallback(
    async (template: AudienceTemplate) => {
      const res = await createTemplateAudiences({
        clientId,
        adAccountId,
        pixelId,
        templateName: template.name,
        event: { eventId: eventId ?? "", code: eventCode ?? "" },
        picks: videoPicks,
      });
      if (res.ok) setVersion((v) => v + 1);
      return res;
    },
    [clientId, adAccountId, pixelId, eventId, eventCode, videoPicks],
  );
  const draft =
    audiences && onAddToDraft
      ? {
          name: draftName ?? "",
          audiences,
          onAdd: onAddToDraft,
          ...(clientId ? { clientId } : {}),
          // A show's videos need a show: without an event code there's nothing to pick from.
          ...(eventCode ? { event: { eventId: eventId ?? "", code: eventCode } } : {}),
          picks: videoPicks,
          onPicks: onVideoPicks,
        }
      : undefined;

  // The Audiences tab stays mounted in the same place whether or not the row
  // shows, and while the templates tab is open: its own state is never reset.
  const shown = showsTemplatesTab(data);
  const onTemplates = shown && tab === "templates";
  return (
    <>
      {shown ? <AudiencesTabRow active={tab} onChange={setTab} /> : null}
      <div className={onTemplates ? "hidden" : "contents"} data-audiences-tab>
        {children}
      </div>
      {onTemplates && data ? <AudienceTemplatesPanel data={data} onSave={onSave} draft={draft} onCreate={onCreate} /> : null}
    </>
  );
}
