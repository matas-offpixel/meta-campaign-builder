"use client";

import { useState } from "react";

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
  DRIVE_LINK,
  DRIVE_LINK_NARROW,
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
  SHARE_WITH_PROMOTER,
  UPLOAD,
  WHICH_FOLDER,
  clipImportLine,
  driveFileUrl,
  driveFolderUrl,
  otherFolderChoices,
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
  asking: string | null;
  onShare?: () => void;
  onStop?: () => void;
  error?: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3 text-sm shadow-sm">
      <p className="font-mono text-xs">{props.folderName}</p>
      <p className="text-xs text-muted-foreground">{props.place}</p>
      <ul className="mt-2">
        {props.rows.map((row) => {
          const href = row.folderId ? driveFolderUrl(row.folderId) : null;
          const body = (
            <>
              <b>{row.name}</b>
              <span>{row.now ? `${row.now} ↗` : row.key === "winners" ? `${row.trailing} ↗` : row.trailing}</span>
            </>
          );
          return (
            <li key={row.key} className="flex items-baseline justify-between gap-3 border-b border-border py-1">
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" className="flex w-full items-baseline justify-between gap-3">
                  {body}
                </a>
              ) : (
                <span className="flex w-full items-baseline justify-between gap-3">{body}</span>
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
        <button type="button" className="rounded border border-border px-2 py-1 text-xs" onClick={props.onShare}>
          {SHARE_WITH_PROMOTER}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {props.asking ? props.asking : props.stateLine.endsWith("Stop sharing") ? (
          <>
            {props.stateLine.slice(0, -"Stop sharing".length)}
            <button type="button" className="underline" onClick={props.onStop}>
              Stop sharing
            </button>
          </>
        ) : props.stateLine}
      </p>
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

export function WhichFolder(props: {
  fileLabel: string;
  choices: FolderChoice[];
  selectedKey: string;
  artists: { id: string; name: string }[];
  onSelect: (choice: FolderChoice) => void;
  onCancel: () => void;
  onUpload: () => void;
  busy?: boolean;
}) {
  const [another, setAnother] = useState(false);
  const [picking, setPicking] = useState<"artist" | "press" | null>(null);
  const selected = props.choices.find((choice) => choice.key === props.selectedKey) ?? props.choices[0];
  const importLine = selected?.artistName && selected.key.includes("artist-clips") ? clipImportLine(selected.artistName) : null;
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <h4 className="font-medium">{WHICH_FOLDER}</h4>
      <p className="mb-2 font-mono text-[11px] text-muted-foreground">{props.fileLabel}</p>
      <div className="max-[700px]:hidden">
        {props.choices.map((choice) => (
          <label key={choice.label} className="flex items-baseline gap-2 py-0.5 text-sm">
            <input type="radio" name="folder" checked={choice.key === props.selectedKey} onChange={() => props.onSelect(choice)} />
            <span>
              {choice.label.includes(CHOOSE_ARTIST) ? (
                <>
                  {choice.label.replace(CHOOSE_ARTIST, "")}
                  <button type="button" className="underline" onClick={() => setPicking(choice.key.includes("press") ? "press" : "artist")}>
                    {CHOOSE_ARTIST}
                  </button>
                </>
              ) : (
                choice.label
              )}
              {choice.likely ? <small className="ml-2 text-muted-foreground">{choice.likely}</small> : null}
            </span>
          </label>
        ))}
        <button type="button" className="underline" onClick={() => setAnother((open) => !open)}>
          {ANOTHER_FOLDER}
        </button>
        {another
          ? otherFolderChoices().map((choice) => (
              <label key={choice.key} className="flex items-baseline gap-2 py-0.5 text-sm">
                <input
                  type="radio"
                  name="folder"
                  checked={choice.key === props.selectedKey}
                  onChange={() => props.onSelect({ key: choice.key, label: choice.label, artistId: null, artistName: null, likely: null })}
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
                  props.onSelect({ key, label, artistId: artist.id, artistName: artist.name, likely: null });
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
          <span>{selected?.label}</span>
          <button type="button" className="underline" onClick={() => setAnother(true)}>
            {CHANGE}
          </button>
        </p>
        {importLine ? <p className="mt-1.5 text-[11.5px] text-muted-foreground">{importLine}</p> : null}
        {another ? (
          <div className="mt-2">
            {props.choices.map((choice) => (
              <button key={choice.label} type="button" className="block py-0.5 text-left text-sm underline" onClick={() => { props.onSelect(choice); setAnother(false); }}>
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
        <button type="button" className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-40" disabled={props.busy} onClick={props.onUpload}>
          {UPLOAD}
        </button>
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

type BoardCell = { text: string; textNarrow?: string; kind: "approved" | "made" | "missing" | "na"; driveFileId?: string | null; drop?: string | null; dropNarrow?: string | null; hot?: boolean };

export function DriveAssetBoard(props: {
  summary: string | null;
  rows: { name: string; sub?: string; narrowName: string; wideOnly?: boolean; cells: BoardCell[] }[];
  footnote: string | null;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-medium">Asset bank</h3>
        {props.summary ? <span className="font-mono text-xs max-[700px]:hidden">{props.summary}</span> : null}
      </div>
      <div className="hidden max-[700px]:grid max-[700px]:grid-cols-[6rem_1fr_1fr] gap-1 text-xs">
        <span />
        <span className="text-muted-foreground">9:16 video</span>
        <span className="text-muted-foreground">4:5</span>
        {props.rows.filter((row) => !row.wideOnly).map((row) => (
          <BoardRow key={row.narrowName} name={row.narrowName} cells={row.cells.slice(0, 2)} narrow />
        ))}
      </div>
      <div className="grid grid-cols-[9rem_repeat(4,1fr)] gap-1 text-xs max-[700px]:hidden">
        <span />
        <span className="text-muted-foreground">9:16 video</span>
        <span className="text-muted-foreground">4:5 static</span>
        <span className="text-muted-foreground">1:1 static</span>
        <span className="text-muted-foreground">9:16 static</span>
        {props.rows.map((row) => (
          <BoardRow key={row.name} name={row.name} sub={row.sub} cells={row.cells} />
        ))}
      </div>
      {props.footnote ? <p className="mt-2 text-[11.5px] text-muted-foreground max-[700px]:hidden">{props.footnote}</p> : null}
      <p className="mt-1.5 hidden text-[10.5px] text-muted-foreground max-[700px]:block">tap ↗ to open in Drive · swipe for 1:1 and 9:16 static →</p>
    </section>
  );
}

function BoardRow({ name, sub, cells, narrow }: { name: string; sub?: string; cells: BoardCell[]; narrow?: boolean }) {
  return (
    <>
      <span>
        <span className="block font-medium">{name}</span>
        {sub && !narrow ? <span className="block text-[10.5px] text-muted-foreground">{sub}</span> : null}
      </span>
      {cells.map((cell, index) => (
        <span key={index} className={`relative flex min-h-16 items-center justify-center rounded border p-1 text-center ${cell.kind === "na" ? "border-transparent text-muted-foreground" : cell.kind === "missing" ? "border-dashed border-border-strong text-muted-foreground" : "border-transparent text-white"} ${cell.hot && !narrow ? "outline outline-1 outline-foreground" : ""}`} style={cell.kind === "approved" || cell.kind === "made" ? { background: "linear-gradient(160deg,#4a3a2a,#9a7a5a)" } : undefined}>
          {cell.kind === "approved" ? <span className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-success text-[10px] font-bold text-white">✓</span> : null}
          {cell.text && cell.text !== "—" && !(narrow && cell.driveFileId) ? <span className="relative">{narrow && cell.textNarrow ? cell.textNarrow : cell.text}</span> : cell.kind === "na" ? "—" : null}
          {cell.drop ? <em className="relative block text-[10px]">{narrow ? cell.dropNarrow ?? cell.drop : cell.drop}</em> : null}
          {cell.driveFileId ? (
            <a href={driveFileUrl(cell.driveFileId)} target="_blank" rel="noreferrer" className="absolute bottom-0.5 left-0.5 text-[10px] text-white underline">
              <span className="max-[700px]:hidden">{DRIVE_LINK}</span>
              <span className="hidden max-[700px]:inline">{DRIVE_LINK_NARROW}</span>
            </a>
          ) : null}
        </span>
      ))}
    </>
  );
}
