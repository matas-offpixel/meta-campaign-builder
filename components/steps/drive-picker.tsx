"use client";

/**
 * From Drive (docs/design-record/2026-11-12-launcher-drive-picker.html, G1–G8):
 * the picker the Meta launcher's creatives step opens from its drop zone. A
 * shared component (G8): the host passes the batch's fields, the identity
 * choices and the batch's row states, and runs the copy itself, so closing
 * the dialog never stops it. 960 px at 1280, full-screen at 393.
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

import { Datum, StatusLine } from "@/components/steps/step-surface";
import { planPrepare, type PlannedAd } from "@/lib/drive/picker-batch";
import {
  PICKER_WORDS as W,
  batchCounts,
  folderTiles,
  formatBytes,
  formatDuration,
  isFailed,
  rowLine,
  splitFileName,
  wrapFileName,
  type AssetModeName,
  type BatchFields,
  type PickerOwner,
  type PickerView,
  type RowState,
  type Tile,
} from "@/lib/drive/picker-model";

export type PickerQuery = { folderId?: string | null; stageKey?: string | null };
export type PickerBatchRow = { rowId: string; name: string; state: RowState };
export type PickerPrepare = { ads: PlannedAd[]; skipped: { name: string; fileId: string }[]; owner: PickerOwner | null; path: string };

export type DrivePickerProps = {
  open: boolean;
  onClose: () => void;
  eventId: string | null;
  eventCode: string;
  fields: BatchFields;
  onFieldsChange: (fields: BatchFields, picked?: { identity: boolean }) => void;
  onClearFields: () => void;
  /** G4 / G7: the host swaps in the identity remembered for the owner. */
  onOwnerChange?: (owner: PickerOwner | null) => void;
  ctaOptions: readonly { value: string; label: string }[];
  pages: readonly { id: string; name: string }[];
  instagramFor: (pageId: string) => readonly { id: string; username: string }[];
  existingNames: readonly string[];
  existingDriveIds: ReadonlySet<string>;
  onPrepare: (plan: PickerPrepare) => void;
  batch: PickerBatchRow[] | null;
  onRetryFailed: () => void;
  /** G6: "Couldn't copy from Drive — Retry" retries that row only. */
  onRetryRow?: (rowId: string) => void;
  onDismissBatch: () => void;
  /** Frames and tests pass a fixture; the default reads the picker route. */
  loadView?: (query: PickerQuery) => Promise<PickerView>;
  thumbnailUrl?: (fileId: string) => string | null;
  initialQuery?: PickerQuery;
  initialSelected?: readonly string[];
};

async function fetchView(eventId: string, query: PickerQuery): Promise<PickerView> {
  const params = new URLSearchParams();
  if (query.folderId) params.set("folder", query.folderId);
  if (query.stageKey) params.set("stage", query.stageKey);
  try {
    const res = await fetch(`/api/events/${eventId}/drive/picker?${params}`);
    const json = (await res.json()) as { view?: PickerView };
    return json.view ?? { state: "unreadable" };
  } catch {
    return { state: "unreadable" };
  }
}

function fieldSummary(fields: BatchFields, cta: string, pageName: string, ig: string): string {
  return ["Caption", fields.url ? "URL" : null, cta, pageName, ig ? `@${ig}` : null].filter(Boolean).join(" · ");
}

export function DrivePicker(props: DrivePickerProps) {
  const { open, onClose, eventId, fields, batch } = props;
  const [query, setQuery] = useState<PickerQuery>(props.initialQuery ?? {});
  const [view, setView] = useState<PickerView | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<AssetModeName>("single");
  const [selected, setSelected] = useState<Set<string>>(new Set(props.initialSelected ?? []));
  const [editFields, setEditFields] = useState(false);
  const [cycleMenu, setCycleMenu] = useState(false);

  const load = props.loadView ?? ((q: PickerQuery) => (eventId ? fetchView(eventId, q) : Promise.resolve<PickerView>({ state: "no_tree" })));
  const { onOwnerChange } = props;

  useEffect(() => {
    if (!open || !eventId) return;
    let live = true;
    setLoading(true);
    void load(query).then((next) => {
      if (!live) return;
      setView(next);
      setLoading(false);
      if (next.state === "ok") onOwnerChange?.(next.owner);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on the query only
  }, [open, eventId, query]);

  const go = useCallback((next: PickerQuery) => {
    setSelected(new Set());
    setCycleMenu(false);
    setQuery(next);
  }, []);

  const tiles = useMemo(() => (view?.state === "ok" ? folderTiles(view.files, mode) : []), [view, mode]);
  const usable = tiles.filter((t) => t.selectable);
  const picked = usable.filter((t) => selected.has(t.file.id));
  const counts = batch ? batchCounts(batch.map((r) => r.state)) : null;
  const pageName = props.pages.find((p) => p.id === fields.identity.pageId)?.name ?? "";
  const igName = props.instagramFor(fields.identity.pageId).find((ig) => ig.id === fields.identity.instagramAccountId)?.username ?? "";
  const ctaLabel = props.ctaOptions.find((o) => o.value === fields.cta)?.label ?? fields.cta;

  if (!open) return null;

  const toggle = (tile: Tile) => {
    if (!tile.selectable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tile.file.id)) next.delete(tile.file.id);
      else next.add(tile.file.id);
      return next;
    });
  };

  const prepare = () => {
    if (view?.state !== "ok" || picked.length === 0) return;
    const plan = planPrepare({
      tiles: picked,
      mode,
      owner: view.owner,
      owners: view.owners,
      folderName: view.folder.name,
      existingNames: props.existingNames,
      existingDriveIds: props.existingDriveIds,
    });
    const path = [view.owner?.name, ...view.below].filter(Boolean).join(" / ") || view.folder.name;
    props.onPrepare({ ...plan, owner: view.owner, path });
    setSelected(new Set());
  };

  const crumbs = view?.state === "ok" ? view.crumbs : [];
  const sameFor = view?.state === "ok" ? view.sameFor : [];
  const ownerChip = (s: { owner: PickerOwner; folderId: string | null }) => (
    <button
      key={s.owner.key}
      type="button"
      disabled={!s.folderId}
      onClick={() => {
        props.onDismissBatch();
        go({ folderId: s.folderId });
      }}
      className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground"
    >
      {s.folderId ? (
        <>
          <span className="md:hidden">{s.owner.name}</span>
          <span className="hidden md:inline">{[s.owner.name, ...(view?.state === "ok" ? view.below : [])].join(" / ")}</span>
        </>
      ) : (
        `${s.owner.name} ${W.ownerEmpty}`
      )}
    </button>
  );

  const empty = (line: string, extra?: React.ReactNode) => (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-sm text-muted-foreground">
      <StatusLine>{line}</StatusLine>
      {extra}
    </div>
  );

  let body: React.ReactNode;
  if (!eventId) body = empty(W.noEvent);
  else if (!view || (loading && view.state !== "ok")) body = empty("…");
  else if (view.state === "no_tree")
    body = empty(
      W.noTree,
      <a href={`/events/${eventId}`} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
        {W.openEvent}
      </a>,
    );
  else if (view.state === "unreadable" || view.state === "not_in_tree") body = empty(W.unreadable);
  else if (batch && counts && !counts.done)
    body = (
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        <StatusLine className="text-sm font-medium">
          {W.preparingHead(counts.n, counts.ready)}
          <span className="font-normal text-muted-foreground">{W.preparingTail}</span>
        </StatusLine>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {batch.map((row) => (
            <li key={row.rowId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <FileName name={row.name} className="font-medium" />
              <span className={`shrink-0 text-xs ${isFailed(row.state) ? "text-destructive" : row.state.kind === "ready" ? "text-success" : "text-muted-foreground"}`}>
                {row.state.kind === "copy_failed" ? (
                  <>
                    {W.copyFailed} —{" "}
                    <button type="button" onClick={() => props.onRetryRow?.(row.rowId)} className="font-medium underline hover:no-underline">
                      {W.retry}
                    </button>
                  </>
                ) : (
                  rowLine(row.state)
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  else if (batch && counts && counts.done)
    body = (
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <StatusLine className="text-sm font-medium">
          {W.endLineHead(counts.ready, counts.skipped, counts.failed)}
          {counts.failed > 0 ? (
            <>
              {" — "}
              <button type="button" onClick={props.onRetryFailed} className="font-medium text-primary hover:underline">
                {W.retry}
              </button>
            </>
          ) : null}
        </StatusLine>
        {/* G7: a folder from the end screen leaves the batch first, as the Next: chips do, so its tiles come back. */}
        <Crumbs
          crumbs={crumbs}
          view={view}
          go={(next) => {
            props.onDismissBatch();
            go(next);
          }}
          cycleMenu={cycleMenu}
          setCycleMenu={setCycleMenu}
        />
        {sameFor.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{W.next}</span>
            {sameFor.map(ownerChip)}
          </div>
        ) : null}
        <Datum className="text-xs text-muted-foreground">
          {W.fieldsKept} ·{" "}
          <button type="button" onClick={props.onClearFields} className="font-medium text-primary hover:underline">
            {W.clearFields}
          </button>
        </Datum>
      </div>
    );
  else {
    const atOwners = view.owner === null && view.owners.length > 0;
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-4 py-3">
          <Crumbs crumbs={crumbs} view={view} go={go} cycleMenu={cycleMenu} setCycleMenu={setCycleMenu} />
        </div>
        <FieldsBar
          fields={fields}
          onChange={props.onFieldsChange}
          ctaOptions={props.ctaOptions}
          pages={props.pages}
          instagramFor={props.instagramFor}
          summary={fieldSummary(fields, ctaLabel, pageName, igName)}
          editing={editFields}
          onEdit={() => setEditFields((v) => !v)}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {atOwners ? (
            <div className="space-y-4">
              <FolderList items={view.owners.map((o) => ({ id: o.folderId, name: o.name }))} go={go} />
              {view.otherFolders.length > 0 ? (
                <div>
                  <Datum className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{W.otherFolders}</Datum>
                  <FolderList items={view.otherFolders} go={go} />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {view.folders.length > 0 ? <FolderList items={view.folders} go={go} /> : null}
              {tiles.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span className="font-medium text-foreground">
                        <span className="md:hidden">{W.selectedNarrow(picked.length, usable.length)}</span>
                        <span className="hidden md:inline">{W.selected(picked.length, usable.length)}</span>
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <select
                        aria-label="Mode"
                        value={mode}
                        onChange={(e) => {
                          setMode(e.target.value as AssetModeName);
                          setSelected(new Set());
                        }}
                        className="hidden rounded border border-border bg-background px-1 py-0.5 text-xs md:inline"
                      >
                        <option value="single">Single 9:16</option>
                        <option value="dual">Dual 4:5 + 9:16</option>
                        <option value="full">Full 4:5 + 9:16 + 1:1</option>
                      </select>
                      <span className="hidden text-muted-foreground md:inline">·</span>
                      <button type="button" onClick={() => setSelected(new Set(usable.map((t) => t.file.id)))} className="font-medium text-primary hover:underline">
                        <span className="md:hidden">{W.selectAllNarrow}</span>
                        <span className="hidden md:inline">{W.selectAll(usable.length)}</span>
                      </button>
                      <span className="text-muted-foreground">·</span>
                      <button type="button" onClick={() => setSelected(new Set())} className="font-medium text-primary hover:underline">
                        {W.none}
                      </button>
                    </div>
                    <span className="hidden text-muted-foreground md:inline">{W.filesLine(tiles.length, tiles.length - usable.length)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {tiles.map((tile) => (
                      <FileTile key={tile.file.id} tile={tile} mode={mode} on={selected.has(tile.file.id)} onToggle={() => toggle(tile)} thumb={props.thumbnailUrl?.(tile.file.id) ?? (eventId && tile.file.hasThumbnail ? `/api/events/${eventId}/drive/picker/thumbnail?file=${encodeURIComponent(tile.file.id)}` : null)} />
                    ))}
                  </div>
                </>
              ) : view.folders.length === 0 ? (
                empty(W.emptyFolder(view.folder.name))
              ) : null}
            </div>
          )}
        </div>
        {sameFor.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">{W.sameFolderFor}</span>
            {sameFor.map(ownerChip)}
          </div>
        ) : null}
      </div>
    );
  }

  const inBatch = Boolean(batch && counts && !counts.done);
  const done = Boolean(batch && counts && counts.done);
  return (
    <div className="fixed inset-0 z-50 flex bg-black/40 md:items-center md:justify-center" role="dialog" aria-modal="true" aria-label={W.dialogTitle(props.eventCode)}>
      <div className="flex h-full w-full flex-col bg-background md:h-auto md:max-h-[90vh] md:w-[960px] md:rounded-xl md:border md:border-border md:shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{W.dialogTitle(props.eventCode)}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        {body}
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {inBatch ? W.closeNote : done ? "" : (
              <>
                <span className="md:hidden">{W.footNoteNarrow}</span>
                <span className="hidden md:inline">{W.footNote}</span>
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            {inBatch || done ? (
              <>
                {counts && counts.failed > 0 ? (
                  <button type="button" onClick={props.onRetryFailed} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
                    {W.retryFailed(counts.failed)}
                  </button>
                ) : null}
                {done ? (
                  <button type="button" onClick={onClose} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                    {W.done}
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <button type="button" onClick={onClose} className="hidden rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted md:inline-block">
                  {W.cancel}
                </button>
                <button
                  type="button"
                  disabled={picked.length === 0}
                  onClick={prepare}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {W.prepare(picked.length)}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type CrumbItem = { label: string; folderId: string | null; menu?: "cycle" };

function Crumbs({ crumbs, view, go, cycleMenu, setCycleMenu }: { crumbs: CrumbItem[]; view: PickerView; go: (q: PickerQuery) => void; cycleMenu: boolean; setCycleMenu: (v: boolean) => void }) {
  const cycles = view.state === "ok" ? view.cycles : [];
  return (
    <nav aria-label="Folder" className="relative flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {crumbs.map((crumb, i) => (
        <span key={`${crumb.label}-${i}`} className={`items-center gap-1 ${i < crumbs.length - 4 ? "hidden md:flex" : "flex"}`}>
          {i > 0 ? <span className={i === crumbs.length - 4 ? "hidden md:inline" : ""}>/</span> : null}
          {crumb.menu === "cycle" ? (
            <span className="relative">
              <button type="button" onClick={() => setCycleMenu(!cycleMenu)} className="inline-flex items-center gap-0.5 font-medium text-foreground hover:underline">
                {crumb.label} <ChevronDown className="h-3 w-3" />
              </button>
              {cycleMenu ? (
                <span className="absolute left-0 top-5 z-10 flex min-w-32 flex-col rounded-md border border-border bg-background py-1 shadow-lg">
                  {cycles.map((cycle) => (
                    <button key={cycle.key} type="button" onClick={() => go({ stageKey: cycle.key })} className="px-3 py-1 text-left text-xs hover:bg-muted">
                      {cycle.label}
                    </button>
                  ))}
                </span>
              ) : null}
            </span>
          ) : (
            <button type="button" onClick={() => crumb.folderId && go({ folderId: crumb.folderId })} className={`hover:underline ${i === crumbs.length - 1 ? "font-medium text-foreground" : ""}`}>
              {crumb.label}
            </button>
          )}
        </span>
      ))}
      {crumbs.length > 4 ? <span className="order-first md:hidden">… /</span> : null}
    </nav>
  );
}

function FolderList({ items, go }: { items: readonly { id: string; name: string }[]; go: (q: PickerQuery) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => go({ folderId: item.id })} className="truncate rounded-lg border border-border px-3 py-2 text-left text-sm font-medium hover:bg-muted">
          {item.name}
        </button>
      ))}
    </div>
  );
}

/** G2: the head truncates; the tail (ratio token, extension) stays in view. Typed glyphs: "9x16", not a ligature. */
function FileName({ name, className }: { name: string; className?: string }) {
  const { head, tail } = splitFileName(name);
  return (
    <span className={`flex min-w-0 ${className ?? ""}`} title={name} style={{ fontFeatureSettings: '"calt" 0' }}>
      <span className="min-w-0 truncate">{head}</span>
      {tail ? <span className="shrink-0 whitespace-pre">{tail}</span> : null}
    </span>
  );
}

let measureCanvas: HTMLCanvasElement | null = null;

/**
 * N1: a tile's name on two lines, breaking after "_" or "-", cut in the
 * middle only past line 2 with the tail kept at the end (`wrapFileName`).
 * The box is always two lines tall, so tiles in a row keep one height.
 * Before the box is measured (and with no canvas) the name wraps at the same
 * breaks and clips at line 2.
 */
function TileName({ name, className }: { name: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const run = () => {
      // The box's real width: a 393 column is 156.5 px, which clientWidth rounds either way.
      const width = el.getBoundingClientRect().width || el.clientWidth;
      if (!width) return;
      measureCanvas ??= document.createElement("canvas");
      const ctx = measureCanvas.getContext("2d");
      if (!ctx) return;
      const cs = window.getComputedStyle(el);
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      // Lines never wrap (whitespace-pre), so a quarter pixel of slack is enough.
      setLines(wrapFileName(name, width - 0.25, (text) => ctx.measureText(text).width));
    };
    run();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(run);
    observer?.observe(el);
    let live = true;
    document.fonts?.ready.then(() => live && run()).catch(() => {});
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [name]);
  return (
    <span
      ref={ref}
      className={`block h-[28px] overflow-hidden leading-[14px] ${className ?? ""}`}
      title={name}
      style={{ fontFeatureSettings: '"calt" 0' }}
    >
      {lines
        ? lines.map((line, i) => (
            <span key={i} className="block whitespace-pre">
              {line}
            </span>
          ))
        : name.split(/(?<=[_-])/).map((part, i) => (
            <Fragment key={i}>
              {part}
              <wbr />
            </Fragment>
          ))}
    </span>
  );
}

function FileTile({ tile, mode, on, onToggle, thumb }: { tile: Tile; mode: AssetModeName; on: boolean; onToggle: () => void; thumb: string | null }) {
  const duration = tile.kind === "video" ? formatDuration(tile.file.durationMs) : null;
  const meta = [tile.kind === "video" ? "Video" : "Static", duration, formatBytes(tile.file.size)].filter(Boolean).join(" · ");
  const pairs = Object.keys(tile.pairs).map((r) => `+ ${r}`).join(" ");
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!tile.selectable}
      aria-pressed={on}
      className={`group flex flex-col overflow-hidden rounded-lg border text-left transition-colors ${on ? "border-primary ring-2 ring-primary/30" : "border-border"} ${tile.selectable ? "hover:border-border-strong" : "cursor-not-allowed opacity-70"}`}
    >
      <div className="relative h-32 w-full bg-muted md:h-36">
        {/* A Drive thumbnail through the app's own route (it needs the export account); next/image can't optimise it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : null}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">{tile.ratio ?? "—"}</span>
        {duration ? <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{duration}</span> : null}
        {pairs ? <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{pairs}</span> : null}
        {tile.selectable ? (
          <span className={`absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded border text-[10px] ${on ? "border-primary bg-primary text-primary-foreground" : "border-white bg-black/30 text-transparent"}`}>✓</span>
        ) : null}
      </div>
      <div className="space-y-0.5 p-2">
        <TileName name={tile.file.name} className="text-[11px] font-medium" />
        <Datum className="text-[10px] text-muted-foreground">{meta}</Datum>
        {tile.reason ? <StatusLine className="text-[10px] font-medium text-destructive">{tile.reason}</StatusLine> : null}
        {tile.note ? <StatusLine className="text-[10px] text-muted-foreground">{tile.note}</StatusLine> : null}
        {tile.selectable && tile.kind === "video" && mode !== "single" ? <StatusLine className="text-[10px] text-muted-foreground">{W.videoSingle}</StatusLine> : null}
      </div>
    </button>
  );
}

function FieldsBar(props: {
  fields: BatchFields;
  onChange: (fields: BatchFields, picked?: { identity: boolean }) => void;
  ctaOptions: readonly { value: string; label: string }[];
  pages: readonly { id: string; name: string }[];
  instagramFor: (pageId: string) => readonly { id: string; username: string }[];
  summary: string;
  editing: boolean;
  onEdit: () => void;
}) {
  const { fields, onChange } = props;
  const igs = props.instagramFor(fields.identity.pageId);
  const input = "w-full rounded-md border border-border bg-background px-2 py-1 text-xs";
  const label = "mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
  const grid = (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
      <label className="md:col-span-2">
        <span className={label}>{W.primaryText}</span>
        <input className={input} value={fields.primaryText} onChange={(e) => onChange({ ...fields, primaryText: e.target.value })} />
      </label>
      <label>
        <span className={label}>{W.headline}</span>
        <input className={input} value={fields.headline} onChange={(e) => onChange({ ...fields, headline: e.target.value })} />
      </label>
      <label>
        <span className={label}>{W.url}</span>
        <input className={input} value={fields.url} onChange={(e) => onChange({ ...fields, url: e.target.value })} />
      </label>
      <label>
        <span className={label}>{W.cta}</span>
        <select className={input} value={fields.cta} onChange={(e) => onChange({ ...fields, cta: e.target.value })}>
          {props.ctaOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="md:col-span-5 md:max-w-sm">
        <span className={label}>{W.identity}</span>
        <span className="flex gap-1">
          <select
            className={input}
            value={fields.identity.pageId}
            onChange={(e) => {
              const pageIgs = props.instagramFor(e.target.value);
              onChange({ ...fields, identity: { pageId: e.target.value, instagramAccountId: pageIgs.length === 1 ? pageIgs[0]!.id : "" } }, { identity: true });
            }}
          >
            {props.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className={input}
            value={fields.identity.instagramAccountId}
            onChange={(e) => onChange({ ...fields, identity: { ...fields.identity, instagramAccountId: e.target.value, instagramActorId: e.target.value } }, { identity: true })}
          >
            <option value="">—</option>
            {igs.map((ig) => (
              <option key={ig.id} value={ig.id}>
                @{ig.username}
              </option>
            ))}
          </select>
        </span>
      </label>
    </div>
  );
  return (
    <div className="border-b border-border bg-muted/30 px-4 py-2.5">
      <div className="flex items-center justify-between gap-2 md:hidden">
        <span className="min-w-0 truncate text-xs text-foreground">{props.summary}</span>
        <button type="button" onClick={props.onEdit} className="shrink-0 text-xs font-medium text-primary">
          {W.edit}
        </button>
      </div>
      <div className={props.editing ? "mt-2 md:mt-0" : "hidden md:block"}>{grid}</div>
    </div>
  );
}
