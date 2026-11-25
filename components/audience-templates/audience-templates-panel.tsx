"use client";

import { useMemo, useState } from "react";

import type { AudienceTemplatesPayload, CreateTemplateResult, TemplatePage } from "@/lib/actions/audience-templates";
import { addTemplateToDraft } from "@/lib/audience-templates/apply";
import type { AudienceSettings } from "@/lib/types";
import type { AudienceTemplate, TemplateItem } from "@/lib/audience-templates/resolve";
import { buildTemplateView, pageItem, rowKey, type TemplateRow } from "@/lib/audience-templates/view";
import { TEMPLATE_NAMES, addedLines, createButtonLabel, createdLines, fw, tw } from "@/lib/audience-templates/words";

/**
 * The Audience templates tab's body (R6, record RC5 / frame RC-E): the
 * template chips, the picked template's items with Reused / Will be created,
 * "Add page to this group", the footer and "Save to template". Draws only:
 * every word and count comes from lib/audience-templates/view.ts.
 *
 * It never touches the draft's audiences and never calls Meta. Saving adds
 * the new pages to the template (onSave); nothing is created here.
 */

/** The draft the tab sits in, for "Add to this draft". The drawer writes it; the tab only hands over the next audiences. */
export interface TemplateDraftTarget {
  name: string;
  audiences: AudienceSettings;
  onAdd: (next: AudienceSettings) => void;
}

export interface AudienceTemplatesPanelProps {
  data: AudienceTemplatesPayload;
  onSave?: (template: AudienceTemplate, pending: TemplateItem[]) => Promise<boolean>;
  draft?: TemplateDraftTarget;
  onCreate?: (template: AudienceTemplate) => Promise<CreateTemplateResult>;
  /** Frames: a result line to open with. */
  initialResult?: string[];
  /** Frames: the state to open in. */
  initialTemplate?: string;
  initialPending?: TemplateItem[];
  initialPickerOpen?: boolean;
}

const NONE: TemplateItem[] = [];

function StatusChip({ status, label }: { status: Exclude<TemplateRow["status"], "held"> | "unconfirmed"; label: string }) {
  const tone =
    status === "reused"
      ? "border-success bg-success text-background"
      : status === "create" || status === "waiting"
        ? "border-dashed border-border-strong text-muted-foreground"
        : "border-warning bg-warning/15 text-warning-foreground";
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] leading-4 ${tone}`}>
      {label}
    </span>
  );
}

function ItemRow({ row }: { row: TemplateRow }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2" data-template-row={row.key}>
      <div className="min-w-0">
        <div className="text-sm leading-5 text-foreground [overflow-wrap:anywhere]">{row.title}</div>
        {row.line ? <div className="text-xs leading-4 text-muted-foreground">{row.line}</div> : null}
      </div>
      {row.status === "held" || !row.statusLabel ? null : <StatusChip status={row.status} label={row.statusLabel} />}
    </div>
  );
}

function GroupLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 mt-4 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </div>
  );
}

function UnconfirmedCard({ template }: { template: AudienceTemplate }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-sm font-semibold text-foreground">{template.name}</div>
      <div className="text-xs text-muted-foreground">
        {template.genreFamilies.join(" + ")}
        {fw("frame.sep")}
        {template.shows.join(", ")}
      </div>
      <div className="mt-1.5">
        <StatusChip status="unconfirmed" label={tw("templates.unconfirmed")} />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{tw("templates.unconfirmed.line")}</p>
    </div>
  );
}

export function AudienceTemplatesPanel({ data, onSave, draft, onCreate, initialResult, initialTemplate, initialPending, initialPickerOpen }: AudienceTemplatesPanelProps) {
  const chips = useMemo(
    () => TEMPLATE_NAMES.map((name) => data.templates.find((t) => t.name === name)).filter((t): t is AudienceTemplate => Boolean(t)),
    [data.templates],
  );
  const extra = data.templates.filter((t) => !TEMPLATE_NAMES.includes(t.name));
  const all = [...chips, ...extra];
  const [selected, setSelected] = useState(initialTemplate ?? all[0]?.name ?? "");
  const [pendingByTemplate, setPendingByTemplate] = useState<Record<string, TemplateItem[]>>(() =>
    initialPending && (initialTemplate ?? all[0]?.name) ? { [initialTemplate ?? all[0]!.name]: initialPending } : {},
  );
  const [pickerOpen, setPickerOpen] = useState(Boolean(initialPickerOpen));
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ template: string; lines: string[] } | null>(null);

  const template = all.find((t) => t.name === selected) ?? all[0];
  const pending = (template ? pendingByTemplate[template.name] : undefined) ?? NONE;
  const view = useMemo(
    () =>
      template
        ? buildTemplateView(
            template,
            data.known,
            {
              accountId: data.accountId,
              accountName: data.accountName,
              pixelId: data.pixelId,
              pixelName: data.pixelName,
              writesEnabled: data.writesEnabled,
              confirmerName: (id) => data.confirmerNames[id] ?? null,
              accountLabel: (id) => data.accountNames[id] ?? null,
            },
            pending,
          )
        : null,
    [template, data, pending],
  );
  if (!template || !view) return null;

  const inGroup = new Set([...template.items, ...pending].flatMap((i) => (i.kind === "page_engagers" && i.pageId ? [i.pageId] : [])));
  const pickable = data.pages.filter((p) => !inGroup.has(p.pageId));
  const addPage = (p: TemplatePage) => {
    const item = pageItem(p.pageId, p.name);
    setPendingByTemplate((prev) => {
      const list = prev[template.name] ?? [];
      return list.some((x) => rowKey(x) === rowKey(item)) ? prev : { ...prev, [template.name]: [...list, item] };
    });
  };
  const save = async () => {
    if (!onSave || pending.length === 0) return;
    setSaving(true);
    try {
      if (await onSave(template, pending)) {
        setPendingByTemplate((prev) => ({ ...prev, [template.name]: [] }));
        setPickerOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };
  const add = () => {
    if (!draft || !view.header.confirmed) return;
    const res = addTemplateToDraft(draft.audiences, template.name, view.resolved);
    draft.onAdd(res.audiences);
    setResult({ template: template.name, lines: addedLines(template.name, draft.name, res.added, res.leftOut) });
  };
  const create = async () => {
    if (!onCreate || !view.header.confirmed || !data.writesEnabled || view.createCount === 0) return;
    setCreating(true);
    try {
      const res = await onCreate(template);
      // Anything but a run that happened reads as none made: the button stays for Try again.
      const lines = res.ok ? createdLines(res.created, res.failed, data.accountName) : createdLines(0, view.createCount, data.accountName);
      setResult({ template: template.name, lines });
    } finally {
      setCreating(false);
    }
  };
  const resultLines = result?.template === template.name ? result.lines : (initialResult ?? []);
  const others = all.filter((t) => t.name !== template.name && !(t.confirmedBy && t.confirmedAt));
  const sep = fw("frame.sep");

  const footer = (
    <div>
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground" role="status">
        {view.footer}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{view.changed ?? ""}</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!view.canSave || saving}
          className="shrink-0 whitespace-nowrap rounded-md border border-border-strong px-3 py-1.5 text-sm text-foreground disabled:opacity-50"
        >
          {tw("templates.save")}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2" data-template-actions>
        <button
          type="button"
          onClick={add}
          disabled={!draft || !view.header.confirmed || view.addCount === 0}
          className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
        >
          {tw("templates.apply")}
        </button>
        {view.createCount > 0 ? (
          <button
            type="button"
            onClick={() => void create()}
            disabled={!onCreate || !view.header.confirmed || !data.writesEnabled || creating}
            className="rounded-md border border-border-strong px-3 py-1.5 text-left text-sm text-foreground disabled:opacity-50 [overflow-wrap:anywhere]"
          >
            {createButtonLabel(view.createCount, data.accountName)}
          </button>
        ) : null}
      </div>
      {resultLines.length > 0 ? (
        <p className="mt-2 text-xs leading-5 text-foreground" role="status" data-template-result>
          {resultLines.join(" ")}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="@container" data-audience-templates>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {all.map((t) => (
          <button
            key={t.name}
            type="button"
            onClick={() => {
              setSelected(t.name);
              setPickerOpen(false);
            }}
            aria-pressed={t.name === template.name}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${
              t.name === template.name ? "border-foreground bg-foreground text-background" : "border-border-strong bg-card text-foreground"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{view.header.name}</h3>
          <p className="text-xs leading-5 text-muted-foreground">
            {view.header.forLine}
            {view.header.confirmedLine ? `${sep}${view.header.confirmedLine}` : ""}
            {sep}
            {view.header.accountLine}
          </p>
          {!view.header.confirmed ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusChip status="unconfirmed" label={tw("templates.unconfirmed")} />
              <span className="text-xs text-muted-foreground">{tw("templates.unconfirmed.line")}</span>
            </div>
          ) : null}

          {view.groups.map((g) =>
            g.rows.length === 0 && g.kind !== "page_engagers" ? null : (
              <section key={g.kind}>
                <GroupLabel>{g.label}</GroupLabel>
                {g.rows.map((row) => (
                  <ItemRow key={row.key} row={row} />
                ))}
                {g.kind === "page_engagers" ? (
                  <div className="my-1.5">
                    <button
                      type="button"
                      onClick={() => setPickerOpen((o) => !o)}
                      aria-expanded={pickerOpen}
                      className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-foreground"
                    >
                      {tw("templates.add_page")}
                    </button>
                    {pickerOpen && pickable.length > 0 ? (
                      <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-md border border-border bg-card" data-template-page-picker>
                        {pickable.map((p) => (
                          <li key={p.pageId}>
                            <button
                              type="button"
                              onClick={() => addPage(p)}
                              className="block w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted [overflow-wrap:anywhere]"
                            >
                              {p.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ),
          )}

          <div className="mt-4 @3xl:hidden">{footer}</div>
        </div>

        <aside className="hidden space-y-3 @3xl:block">
          {footer}
          {others.map((t) => (
            <UnconfirmedCard key={t.name} template={t} />
          ))}
        </aside>
      </div>
    </div>
  );
}
