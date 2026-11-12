"use client";

import { useEffect, useId, useState } from "react";

import {
  ANOTHER_FOLDER,
  CANCEL,
  CHANGE,
  CHOOSE_ARTIST,
  CREATE_BUTTON,
  CREATE_HINT,
  CREATE_NOTE,
  CREATE_TITLE,
  DRIVE_FAILED_LEAD,
  DRIVE_HEADER,
  DRIVE_RETRY,
  FROM_THE_LAB,
  IN_DRIVE,
  LAB_ADD,
  LAB_ADDED,
  LAB_EMPTY,
  LINK_BUTTON,
  LINK_HINT,
  LINK_NOTE,
  LINK_TITLE,
  OPEN_IN_DRIVE,
  SETUP_HEADER,
  SETUP_INTRO,
  SETUP_INTRO_NARROW,
  SETUP_TITLE,
  SHARE,
  SHARE_WITH_PROMOTER,
  CHOOSE_OWNER,
  CHOOSE_TYPE,
  UPLOAD,
  WHICH_FOLDER,
  anotherFolderChoice,
  clipImportLine,
  creativesNote,
  driveFolderUrl,
  otherFolderChoices,
  typeFolderName,
  uploadReady,
  withKind,
  withOwner,
  type FolderChoice,
} from "@/lib/drive/panel";

export function InDriveMark() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-foreground px-1.5 py-0.5 text-[11px] text-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-success" />
      {IN_DRIVE}
    </span>
  );
}

export function DriveFailed({ onRetry, busy }: { onRetry?: () => void; busy?: boolean }) {
  return (
    <p className="text-xs text-destructive">
      {DRIVE_FAILED_LEAD}
      {onRetry ? (
        <button type="button" className="underline" disabled={busy} onClick={onRetry}>
          {DRIVE_RETRY}
        </button>
      ) : (
        <u>{DRIVE_RETRY}</u>
      )}
    </p>
  );
}

export function DriveHeaderLink({ hasFolder, onClick }: { hasFolder: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="text-sm underline" onClick={onClick}>
      {hasFolder ? DRIVE_HEADER : SETUP_HEADER}
    </button>
  );
}

export function DrivePanel(props: {
  folderName: string;
  place: string;
  rows: { key: string; name: string; folderId: string | null; now: string | null; trailing: string }[];
  openUrl: string | null;
  stateLine: string;
  shared?: boolean;
  asking: string | null;
  onShare?: () => void;
  onConfirm?: () => void;
  onCancel?: () => void;
  onStop?: () => void;
  error?: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3 text-[12px] shadow-sm">
      <p className="font-mono text-[12px]">{props.folderName}</p>
      <p className="text-[12px] text-muted-foreground">{props.place}</p>
      <ul className="mt-2">
        {props.rows.map((row) => {
          const href = row.folderId ? driveFolderUrl(row.folderId) : null;
          const trailing = row.now ? `${row.now} ↗` : row.key === "winners" ? `${row.trailing} ↗` : row.trailing;
          const body = (
            <>
              <b className="shrink-0">{row.name}</b>
              <span className="shrink-0">{trailing}</span>
            </>
          );
          return (
            <li key={row.key} className="border-b border-border py-1">
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" className="flex items-baseline justify-between gap-2 whitespace-nowrap">
                  {body}
                </a>
              ) : (
                <span className="flex items-baseline justify-between gap-2 whitespace-nowrap">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2">
        {props.openUrl ? (
          <a href={props.openUrl} target="_blank" rel="noreferrer" className="underline">
            {OPEN_IN_DRIVE}
          </a>
        ) : (
          <span />
        )}
        {props.shared ? null : (
          <button type="button" className="rounded border border-border px-2 py-1 text-[12px]" onClick={props.onShare}>
            {SHARE_WITH_PROMOTER}
          </button>
        )}
      </div>
      {props.asking ? (
        <div className="mt-2">
          <p>{props.asking}</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="rounded border border-border px-2 py-1" onClick={props.onCancel}>
              {CANCEL}
            </button>
            <button type="button" className="rounded bg-foreground px-2 py-1 text-background" onClick={props.onConfirm}>
              {SHARE}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {props.stateLine.endsWith("Stop sharing") ? (
            <>
              {props.stateLine.slice(0, -"Stop sharing".length)}
              <button type="button" className="underline" onClick={props.onStop}>
                Stop sharing
              </button>
            </>
          ) : (
            props.stateLine
          )}
        </p>
      )}
      {props.error ? <p className="mt-1 text-[11px] text-destructive">{props.error}</p> : null}
    </div>
  );
}

export function DriveSetup(props: {
  treePath: string;
  resolved: { name: string; fileCount: number; place: string } | null;
  error: string | null;
  link: string;
  onLinkChange: (value: string) => void;
  onResolve: () => void;
  onLink: () => void;
  onCreate: () => void;
  busy?: boolean;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-medium">{SETUP_TITLE}</h3>
        <p className="text-sm text-muted-foreground">
          <span className="max-[700px]:hidden">{SETUP_INTRO}</span>
          <span className="hidden max-[700px]:inline">{SETUP_INTRO_NARROW}</span>
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <h4 className="font-medium">{LINK_TITLE}</h4>
          <p className="mb-2 text-sm text-muted-foreground">{LINK_HINT}</p>
          <input
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs"
            value={props.link}
            onChange={(event) => props.onLinkChange(event.target.value)}
            onBlur={props.onResolve}
          />
          {props.resolved ? (
            <p className="mt-2 text-xs">
              <b>{props.resolved.name}</b> <span className="text-muted-foreground">· {props.resolved.fileCount} files · {props.resolved.place}</span>
            </p>
          ) : null}
          {props.error ? <p className="mt-2 text-xs text-destructive">{props.error}</p> : null}
          <p className="mt-2 text-[11.5px] text-muted-foreground">{LINK_NOTE}</p>
          <button type="button" className="mt-2 rounded bg-foreground px-2 py-1 text-xs text-background disabled:opacity-40" disabled={!props.resolved || props.busy} onClick={props.onLink}>
            {LINK_BUTTON}
          </button>
        </div>
        <div className="rounded-md border border-border p-3">
          <h4 className="font-medium">{CREATE_TITLE}</h4>
          <p className="mb-2 text-sm text-muted-foreground">{CREATE_HINT}</p>
          <p className="text-xs">{props.treePath}</p>
          <p className="mt-2 text-[11.5px] text-muted-foreground">{CREATE_NOTE}</p>
          <button type="button" className="mt-2 rounded border border-border px-2 py-1 text-xs" disabled={props.busy} onClick={props.onCreate}>
            {CREATE_BUTTON}
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * The creatives row's two pickers (2026-11-11-creative-lab-upload-owner, U1,
 * U4): who it's for, then Videos or Statics. Lists, not native selects, so the
 * open owner list can be drawn (CLS7b). The lineup comes first in billing
 * order, then a rule, then the promoter.
 */
export function CreativesPickers(props: {
  choice: FolderChoice;
  onChange: (choice: FolderChoice) => void;
  stacked?: boolean;
  /** Frames only: draw this list open. */
  openList?: "owner" | "type" | null;
}) {
  const [open, setOpen] = useState<"owner" | "type" | null>(props.openList ?? null);
  const row = props.choice.creatives;
  if (!row) return null;
  const artists = row.owners.filter((owner) => owner.kind === "artist");
  const promoter = row.owners.filter((owner) => owner.kind === "promoter");
  const trigger = "inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-sm";
  // Stacked (393, a sheet): the list opens in the flow so the sheet grows to show it all.
  const list = props.stacked
    ? "mt-1 block min-w-[180px] rounded-md border border-border bg-card py-1 text-sm shadow-sm"
    : "absolute left-0 top-full z-10 mt-1 min-w-[180px] rounded-md border border-border bg-card py-1 text-sm shadow-sm";
  const item = "block w-full px-2.5 py-1 text-left hover:bg-muted";
  return (
    <span className={props.stacked ? "flex flex-col items-start gap-1.5" : "inline-flex flex-wrap items-baseline gap-1"}>
      <span className={props.stacked ? "block" : "relative"}>
        <button type="button" aria-haspopup="listbox" aria-expanded={open === "owner"} className={`${trigger} ${row.owner ? "" : "text-muted-foreground"}`} onClick={() => setOpen(open === "owner" ? null : "owner")}>
          {row.owner?.name ?? CHOOSE_OWNER}
          <span aria-hidden>▾</span>
        </button>
        {open === "owner" ? (
          <span role="listbox" className={list}>
            {artists.map((owner) => (
              <button key={owner.ref} type="button" role="option" aria-selected={row.owner?.ref === owner.ref} className={item} onClick={() => { props.onChange(withOwner(props.choice, owner.ref)); setOpen(null); }}>
                {owner.name}
              </button>
            ))}
            {promoter.length ? <span className="my-1 block border-t border-border" /> : null}
            {promoter.map((owner) => (
              <button key={owner.ref} type="button" role="option" aria-selected={row.owner?.ref === owner.ref} className={item} onClick={() => { props.onChange(withOwner(props.choice, owner.ref)); setOpen(null); }}>
                {owner.name}
              </button>
            ))}
          </span>
        ) : null}
      </span>
      {props.stacked ? null : <span>/</span>}
      <span className={props.stacked ? "block" : "relative"}>
        <button type="button" aria-haspopup="listbox" aria-expanded={open === "type"} className={`${trigger} ${row.kind ? "" : "text-muted-foreground"}`} onClick={() => setOpen(open === "type" ? null : "type")}>
          {row.kind ? typeFolderName(row.kind) : CHOOSE_TYPE}
          <span aria-hidden>▾</span>
        </button>
        {open === "type" ? (
          <span role="listbox" className={list}>
            {(["video", "static"] as const).map((kind) => (
              <button key={kind} type="button" role="option" aria-selected={row.kind === kind} className={item} onClick={() => { props.onChange(withKind(props.choice, kind)); setOpen(null); }}>
                {typeFolderName(kind)}
              </button>
            ))}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function WhichFolder(props: {
  fileLabel: string;
  choices: FolderChoice[];
  selectedKey: string;
  artists: { id: string; name: string }[];
  onSelect: (choice: FolderChoice) => void;
  onCancel: () => void;
  onUpload: () => void;
  busy?: boolean;
  /** The file, for a stage picked under "Another folder…" (its owner and type preselect the same way). */
  file?: { name: string; mimeType?: string | null } | null;
  /** The folder map's keys: "Makes … with this upload." and the older cycles under "Another folder…". */
  folderKeys?: string[] | null;
  /** Frames only: draw a creatives picker's list open. */
  openList?: "owner" | "type" | null;
}) {
  const group = useId();
  const titleId = useId();
  const onCancel = props.onCancel;
  const [another, setAnother] = useState(false);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const [picking, setPicking] = useState<"artist" | "press" | null>(null);
  // A choice made here that the parent's list doesn't hold (a stage under "Another folder…", or a
  // picker change before the parent re-renders) is kept so the dialog shows what was picked.
  const [extra, setExtra] = useState<FolderChoice | null>(null);
  const select = (choice: FolderChoice) => {
    setExtra(props.choices.some((row) => row.key === choice.key) ? null : choice);
    props.onSelect(choice);
  };
  const selected = props.choices.find((choice) => choice.key === props.selectedKey) ?? (extra && extra.key === props.selectedKey ? extra : props.choices[0]);
  const importLine = selected?.artistName && selected.key.includes("artist-clips") ? clipImportLine(selected.artistName) : null;
  const folderKeys = props.folderKeys ? new Set(props.folderKeys) : null;
  const note = creativesNote(selected, folderKeys);
  const creativesRow = props.choices.find((choice) => choice.creatives);
  const others = otherFolderChoices({ folderKeys: props.folderKeys, currentStageKey: creativesRow?.creatives?.stageKey ?? null });
  const pickOther = (picked: { key: string; label: string }) =>
    select(anotherFolderChoice(picked, { owners: creativesRow?.creatives?.owners ?? null, artists: props.artists }, props.file ?? null));
  const isSelected = (choice: FolderChoice) => choice.key === props.selectedKey || Boolean(choice.creatives && selected?.creatives && choice.creatives.stageKey === selected.creatives.stageKey);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-6 max-[700px]:items-end max-[700px]:p-0">
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-[540px] rounded-md border border-border bg-card p-4 shadow-sm max-[700px]:rounded-b-none">
      <h4 id={titleId} className="font-medium">{WHICH_FOLDER}</h4>
      <p className="mb-2 font-mono text-[11px] text-muted-foreground">{props.fileLabel}</p>
      <div className="max-[700px]:hidden">
        {props.choices.map((choice) => (
          <div key={choice.creatives ? `creatives:${choice.creatives.stageKey}` : choice.label}>
            <label className="flex items-baseline gap-2 py-0.5 text-sm">
              <input type="radio" name={group} className="accent-foreground" checked={isSelected(choice)} onChange={() => select(choice)} />
              <span>
                {choice.creatives ? (
                  <>
                    {choice.creatives.stageLabel} /{" "}
                    <CreativesPickers choice={isSelected(choice) && selected?.creatives ? selected : choice} onChange={select} openList={props.openList} />
                  </>
                ) : choice.label.includes(CHOOSE_ARTIST) ? (
                  <>
                    {choice.label.replace(CHOOSE_ARTIST, "")}
                    <button type="button" className="underline" onClick={() => setPicking(choice.key.includes("press") ? "press" : "artist")}>
                      {CHOOSE_ARTIST}
                    </button>
                  </>
                ) : (
                  choice.label
                )}
                {(isSelected(choice) && selected?.creatives ? selected.likely : choice.likely) ? (
                  <small className="ml-2 text-muted-foreground">{isSelected(choice) && selected?.creatives ? selected.likely : choice.likely}</small>
                ) : null}
              </span>
            </label>
            {choice.creatives && isSelected(choice) && note ? <p className="mb-1 ml-6 text-[11.5px] text-muted-foreground">{note}</p> : null}
          </div>
        ))}
        {selected?.creatives && !props.choices.some((choice) => choice.creatives && choice.creatives.stageKey === selected.creatives!.stageKey) ? (
          <div>
            <p className="py-0.5 text-sm">
              {selected.creatives.stageLabel} / <CreativesPickers choice={selected} onChange={select} openList={props.openList} />
            </p>
            {note ? <p className="mb-1 ml-6 text-[11.5px] text-muted-foreground">{note}</p> : null}
          </div>
        ) : null}
        <button type="button" className="underline" onClick={() => setAnother((open) => !open)}>
          {ANOTHER_FOLDER}
        </button>
        {another
          ? others.map((choice) => (
              <label key={choice.key} className="flex items-baseline gap-2 py-0.5 text-sm">
                <input
                  type="radio"
                  name={group}
                  className="accent-foreground"
                  checked={choice.key === props.selectedKey || selected?.creatives?.stageKey === choice.key}
                  onChange={() => pickOther(choice)}
                />
                {choice.label}
              </label>
            ))
          : null}
        {picking ? (
          <div className="mt-1">
            {props.artists.map((artist) => (
              <button
                key={artist.id}
                type="button"
                className="block underline"
                onClick={() => {
                  const label = picking === "press" ? `02 Source / Press kits / ${artist.name}` : `02 Source / Artist clips / ${artist.name}`;
                  const key = picking === "press" ? `02/press-kits/${artist.id}` : `02/artist-clips/${artist.id}`;
                  select({ key, label, artistId: artist.id, artistName: artist.name, likely: null });
                  setPicking(null);
                }}
              >
                {artist.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="hidden max-[700px]:block">
        <p className="flex items-baseline justify-between gap-2 text-xs">
          <span>{selected?.creatives ? selected.creatives.stageLabel : selected?.label}</span>
          <button type="button" className="underline" onClick={() => setAnother(true)}>
            {CHANGE}
          </button>
        </p>
        {selected?.creatives ? (
          <div className="mt-1.5 pl-3">
            <CreativesPickers choice={selected} onChange={select} stacked openList={props.openList} />
          </div>
        ) : null}
        {note ? <p className="mt-1.5 text-[11.5px] text-muted-foreground">{note}</p> : null}
        {importLine ? <p className="mt-1.5 text-[11.5px] text-muted-foreground">{importLine}</p> : null}
        {another ? (
          <div className="mt-2">
            {props.choices.map((choice) => (
              <button key={choice.creatives ? `creatives:${choice.creatives.stageKey}` : choice.label} type="button" className="block py-0.5 text-left text-sm underline" onClick={() => { select(choice); setAnother(false); }}>
                {choice.creatives ? choice.creatives.stageLabel : choice.label}
              </button>
            ))}
            {others.map((choice) => (
              <button key={choice.key} type="button" className="block py-0.5 text-left text-sm underline" onClick={() => { pickOther(choice); setAnother(false); }}>
                {choice.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="rounded border border-border px-3 py-1 text-sm" onClick={props.onCancel}>
          {CANCEL}
        </button>
        <button type="button" className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-40" disabled={props.busy || !uploadReady(selected)} onClick={props.onUpload}>
          {UPLOAD}
        </button>
      </div>
    </div>
    </div>
  );
}

export function LabSource(props: {
  eventName: string;
  rows: { id: string; pairing: string; narrowPairing: string; roundNo: number; length: string | null; inDrive: boolean; added: boolean }[];
  empty?: boolean;
  heading?: boolean;
  tabs?: boolean;
  onAdd?: (id: string) => void;
}) {
  const added = props.rows.filter((row) => row.added).length;
  return (
    <div className="space-y-2">
      {props.heading === false ? null : <div>
        <h3 className="font-medium">② Creatives</h3>
        {added > 0 ? (
          <p className="text-xs text-muted-foreground">
            <span className="max-[700px]:hidden">{props.eventName} · {added} added from the Lab, each the 9:16 of its creative</span>
            <span className="hidden max-[700px]:inline">{added} added from the Lab</span>
          </p>
        ) : null}
      </div>}
      {props.tabs ? (
        <div className="flex gap-3 text-sm">
          <span className="text-muted-foreground">Upload</span>
          <span className="text-muted-foreground">Drive</span>
          <span className="underline">{FROM_THE_LAB}</span>
        </div>
      ) : null}
      {props.empty ? <p className="text-sm text-muted-foreground">{LAB_EMPTY}</p> : null}
      {props.rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[2.125rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-border py-1.5 sm:grid-cols-[2.125rem_minmax(0,1fr)_auto_auto]">
          <span className="h-14 w-8 rounded bg-muted" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              <span className="max-[700px]:hidden">{row.pairing}</span>
              <span className="hidden max-[700px]:inline">{row.narrowPairing}</span>
            </p>
            <p className="text-[10.5px] text-muted-foreground">
              <span className="max-[700px]:hidden">Round {row.roundNo} · 9:16{row.length ? ` · ${row.length}` : ""}</span>
              <span className="hidden max-[700px]:inline">R{row.roundNo}{row.length ? ` · ${row.length}` : ""}</span>
              {row.inDrive ? <span className="ml-1 hidden max-[700px]:inline"><InDriveMark /></span> : null}
            </p>
          </div>
          {row.inDrive ? <span className="max-[700px]:hidden"><InDriveMark /></span> : <span className="max-[700px]:hidden" />}
          {props.onAdd ? (
            <button type="button" className="rounded border border-border px-2 py-1 text-xs" disabled={row.added} onClick={() => props.onAdd?.(row.id)}>
              {row.added ? LAB_ADDED : LAB_ADD}
            </button>
          ) : (
            <span className={`rounded border border-border px-2 py-1 text-xs ${row.added ? "bg-foreground text-background" : ""}`}>{row.added ? LAB_ADDED : LAB_ADD}</span>
          )}
        </div>
      ))}
    </div>
  );
}
