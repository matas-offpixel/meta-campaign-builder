"use client";

import { AssetBoard } from "@/components/dashboard/asset-bank/surface";
import { RenderRows } from "@/components/dashboard/events/creative-lab/render-rows";
import { EventDetailHeader } from "@/components/dashboard/events/event-detail-header";
import { MmlCreativeIntake } from "@/components/plan/mml-creative-intake";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { fortnightlyFrom } from "@/lib/drive/tree";
import { formatFileSize, panelRows, preselectFolder, usualFolders, type FolderChoice, type SharePhase } from "@/lib/drive/panel";

import { DriveSetup, WhichFolder } from "./ui";

const CAL = fortnightlyFrom("2026-11-02");
const TODAY = "2026-11-17";
const NOW = new Date("2026-11-17T12:00:00.000Z");
const ARTISTS = [{ id: "enzo", name: "Enzo Siragusa" }];

const ROWS = panelRows({
  folders: ["00", "01", "02", "03", "04", "05", "06", "winners"].map((key) => ({ key, driveFolderId: key })),
  winnerCount: 0,
  status: "on_sale",
  eventDate: "2026-12-27",
  today: TODAY,
  calendar: CAL,
});

const PREVIEW = {
  folderName: "2026-12-27 Puzzle 4th Birthday [P26-BDAY]",
  place: "Off / Pixel › Puzzle",
  treePath: "Off / Pixel › Puzzle › 2026-12-27 Puzzle 4th Birthday [P26-BDAY]",
  shared: false,
  clientName: "Puzzle",
  contactEmail: "promoter@puzzle.example",
  rows: ROWS,
  openUrl: "https://drive.google.com/drive/folders/event",
};

function thumb(fill: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="28"><rect width="16" height="28" fill="${fill}"/></svg>`)}`;
}

function renderRow(row: {
  id: string;
  label: string;
  narrowLabel: string;
  status: string;
  driveStatus?: string | null;
  driveFileName?: string | null;
  durationSeconds?: number | null;
  fill?: string;
  updatedAt?: string;
}): CreativeLabCardData["renders"][number] {
  return {
    id: row.id,
    clipId: row.id,
    captionId: "cap",
    label: row.label,
    narrowLabel: row.narrowLabel,
    status: row.status,
    error: null,
    renderMs: row.status === "done" ? 180000 : null,
    updatedAt: row.updatedAt ?? "2026-11-17T12:00:00.000Z",
    previewUrl: null,
    posterUrl: null,
    clipPreviewUrl: null,
    thumbUrl: row.fill ? thumb(row.fill) : null,
    lines: [],
    playing: false,
    roundOpen: true,
    driveStatus: row.driveStatus ?? null,
    driveFileName: row.driveFileName ?? null,
    durationSeconds: row.durationSeconds ?? null,
  };
}

const RENDERS: CreativeLabCardData["renders"] = [
  renderRow({ id: "1", label: "Enzo #1 × Lineup \"at Circuit\"", narrowLabel: "Enzo #1 × \"at Circuit\"", status: "done", driveStatus: "copied", driveFileName: "P26-BDAY_enzo-siragusa-1_lineup1-on-sale_r1_9x16.mp4", durationSeconds: 18, fill: "#8a7358" }),
  renderRow({ id: "2", label: "Enzo #1 × Lineup \"turns 4\"", narrowLabel: "Enzo #1 × \"turns 4\"", status: "done", driveStatus: "copied", driveFileName: "P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16.mp4", durationSeconds: 18, fill: "#8a7358" }),
  renderRow({ id: "3", label: "Enzo #2 × Lineup \"at Circuit\"", narrowLabel: "Enzo #2 × \"at Circuit\"", status: "done", driveStatus: "failed", driveFileName: "P26-BDAY_enzo-siragusa-2_lineup1-on-sale_r1_9x16.mp4", durationSeconds: 22, fill: "#6e5a48" }),
  renderRow({ id: "4", label: "Enzo #5 × Lineup \"at Circuit\"", narrowLabel: "Enzo #5 × \"at Circuit\"", status: "done", driveFileName: "P26-BDAY_enzo-siragusa-5_lineup1-on-sale_r1_9x16.mp4", durationSeconds: 15, fill: "#9a7a5a" }),
  renderRow({ id: "5", label: "Enzo #5 × Lineup \"turns 4\"", narrowLabel: "Enzo #5 × \"turns 4\"", status: "rendering", updatedAt: "2026-11-17T11:59:20.000Z", fill: "#9a7a5a" }),
];

function Header({ setup = false, open = false, phase, shared = false }: { setup?: boolean; open?: boolean; phase?: SharePhase; shared?: boolean }) {
  return (
    <EventDetailHeader
      event={{
        id: "frame-event",
        name: "Puzzle 4th Birthday",
        kind: "event",
        status: "on_sale",
        event_date: "2026-12-27",
        drive_folder_id: setup ? null : "folder",
        client: { id: "puzzle", name: "Puzzle" },
      }}
      lab={null}
      linkedQuote={null}
      favourite={false}
      favWorking={false}
      now={NOW}
      confirmDelete={false}
      working={false}
      onToggleFavourite={() => undefined}
      onEdit={() => undefined}
      onAskDelete={() => undefined}
      onCancelDelete={() => undefined}
      onDelete={() => undefined}
      drivePreview={setup ? null : { ...PREVIEW, shared }}
      driveInitialOpen={open}
      driveInitialPhase={phase}
    />
  );
}

const PDF = preselectFolder({ name: "Puzzle-4th-set-times-v3.pdf" }, { artists: ARTISTS, status: "on_sale", eventDate: "2026-12-27", today: TODAY, calendar: CAL });
const CLIP = preselectFolder({ name: "enzo-boiler-room-2025.mp4", fromClips: true, artistId: "enzo" }, { artists: ARTISTS, status: "on_sale", eventDate: "2026-12-27", today: TODAY, calendar: CAL });

function FolderQuestion({ file, selected }: { file: { name: string; bytes: number }; selected: FolderChoice }) {
  return (
    <WhichFolder
      fileLabel={`${file.name} · ${formatFileSize(file.bytes)}`}
      choices={usualFolders({ artists: ARTISTS, status: "on_sale", eventDate: "2026-12-27", today: TODAY, calendar: CAL }, selected)}
      selectedKey={selected.key}
      artists={ARTISTS}
      onSelect={() => undefined}
      onCancel={() => undefined}
      onUpload={() => undefined}
    />
  );
}

export function DriveFrames({ id }: { id: string }) {
  if (id === "CLS5" || id === "CLS5b" || id === "CLS5c" || id === "CLS5d") {
    const open = id !== "CLS5";
    const phase: SharePhase | undefined = id === "CLS5c" ? "asking" : undefined;
    const shared = id === "CLS5d";
    return (
      <div data-frame-ready={id} className={`bg-background text-foreground ${open ? "min-h-screen" : ""}`}>
        <Header open={open} phase={phase} shared={shared} />
        <div className="p-4">
          <RenderRows rows={RENDERS} now="2026-11-17T12:00:00.000Z" />
        </div>
      </div>
    );
  }
  if (id === "CLS6") {
    const rows = [
      { id: "1", pairing: "Enzo #1 × Lineup \"at Circuit\"", narrowPairing: "Enzo #1 × \"at Circuit\"", roundNo: 1, length: "0:18", inDrive: true, added: true },
      { id: "2", pairing: "Enzo #1 × Lineup \"turns 4\"", narrowPairing: "Enzo #1 × \"turns 4\"", roundNo: 1, length: "0:18", inDrive: true, added: true },
      { id: "3", pairing: "Enzo #2 × Lineup \"at Circuit\"", narrowPairing: "Enzo #2 × \"at Circuit\"", roundNo: 1, length: "0:22", inDrive: false, added: false },
      { id: "4", pairing: "Enzo #5 × Lineup \"at Circuit\"", narrowPairing: "Enzo #5 × \"at Circuit\"", roundNo: 1, length: "0:15", inDrive: false, added: false },
    ];
    return (
      <div data-frame-ready={id} className="bg-background p-4 text-foreground">
        <MmlCreativeIntake planId="frame-plan" clientId={null} persisted onLaunches={() => undefined} fixture={{ eventName: "Puzzle 4th Birthday", rows }} />
      </div>
    );
  }
  if (id === "CLS7") {
    return (
      <div data-frame-ready={id} className="relative min-h-screen bg-background text-foreground">
        <Header />
        <div className="max-[700px]:hidden">
          <FolderQuestion file={{ name: "Puzzle-4th-set-times-v3.pdf", bytes: 84 * 1024 }} selected={PDF} />
        </div>
        <div className="hidden max-[700px]:block">
          <FolderQuestion file={{ name: "enzo-boiler-room-2025.mp4", bytes: 48 * 1024 * 1024 }} selected={CLIP} />
        </div>
      </div>
    );
  }
  if (id === "CLS8") {
    return (
      <div data-frame-ready={id} className="bg-background text-foreground">
        <Header setup />
        <div className="p-4">
          <div className="max-[700px]:hidden">
            <DriveSetup treePath={PREVIEW.treePath} resolved={{ name: "Puzzle Video", fileCount: 46, place: "Off / Pixel › Puzzle" }} error={null} link="https://drive.google.com/drive/folders/1kPzV…" onLinkChange={() => undefined} onResolve={() => undefined} onLink={() => undefined} onCreate={() => undefined} />
          </div>
          <div className="hidden max-[700px]:block">
            <DriveSetup treePath={PREVIEW.treePath} resolved={null} error="Can't open that folder — share it with the export account or move it into Off / Pixel, then link it again." link="https://drive.google.com/drive/folders/1kPzV…" onLinkChange={() => undefined} onResolve={() => undefined} onLink={() => undefined} onCreate={() => undefined} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div data-frame-ready={id} className="bg-background p-4 text-foreground">
      <AssetBoard
        drive={{
          summary: "7 approved · 2 missing",
          footnote: "Artist card · 4:5 opens in Drive: 03 Creatives / 1 Signup / Announcement. Dropping the piece into 01 Open files queues the kit audit; the cell fills when it passes.",
          swipe: "tap ↗ to open in Drive · swipe for 1:1 and 9:16 static →",
          rows: [
            { name: "Headliner UGC · promoter voice", narrowName: "UGC · promoter", cells: [
              { text: "Enzo #2", status: "approved", driveFileId: "ugc" },
              { text: "—", status: "na" },
              { text: "—", status: "na" },
              { text: "—", status: "na" },
            ] },
            { name: "Artist card", sub: "A–Z, press shot", narrowName: "Artist card", cells: [
              { text: "+ audio 15 s", textNarrow: "+ audio", status: "made" },
              { text: "", status: "approved", driveFileId: "card45", hot: true },
              { text: "", status: "approved", driveFileId: "card11" },
              { text: "+ needs Reeshy's press shot", status: "missing", dropFolder: "drop it in 02 Source / Press kits / Reeshy", dropNarrow: "02 Source / Press kits / Reeshy" },
            ] },
            { name: "Lineup artwork edit", narrowName: "Lineup edit", cells: [
              { text: "+ needs the piece", status: "missing", dropFolder: "drop it in 01 Open files", dropNarrow: "01 Open files" },
              { text: "", status: "approved", driveFileId: "line45" },
              { text: "", status: "approved", driveFileId: "line11" },
              { text: "", status: "made" },
            ] },
            { name: "Selling fast", sub: "true · approved", narrowName: "Selling fast", wideOnly: true, cells: [
              { text: "", status: "approved", driveFileId: "sell916" },
              { text: "", status: "approved", driveFileId: "sell45" },
              { text: "—", status: "na" },
              { text: "—", status: "na" },
            ] },
          ],
        }}
      />
    </div>
  );
}
