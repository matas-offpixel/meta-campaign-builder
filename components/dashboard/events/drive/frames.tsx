"use client";

import { fortnightlyFrom } from "@/lib/drive/tree";
import { formatFileSize, panelRows, preselectFolder, usualFolders, type FolderChoice } from "@/lib/drive/panel";

import { DriveAssetBoard, DriveFailed, DrivePanel, DriveSetup, InDriveMark, LabSource, WhichFolder } from "./ui";

const CAL = fortnightlyFrom("2026-11-02");
const TODAY = "2026-11-17";

const ROWS = panelRows({
  folders: ["00", "01", "02", "03", "04", "05", "06", "winners"].map((key) => ({ key, driveFolderId: key })),
  winnerCount: 0,
  status: "on_sale",
  eventDate: "2026-12-27",
  today: TODAY,
  calendar: CAL,
});

function Head({ setup = false, narrow = false }: { setup?: boolean; narrow?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className={narrow ? "block" : "flex items-start justify-between gap-3 max-[700px]:block"}>
        <div>
          <h4 className="text-base font-medium">Puzzle 4th Birthday</h4>
          <p className="text-xs text-muted-foreground">
            <span className="max-[700px]:hidden">Puzzle · P26-BDAY · 27 Dec 2026 · Circuit, Southampton</span>
            <span className="hidden max-[700px]:inline">Puzzle · P26-BDAY · 27 Dec 2026</span>
          </p>
        </div>
        <p className="mt-2 flex gap-3 text-sm sm:mt-0">
          <span>View client</span>
          <span>{setup ? "Set up Drive" : "Drive folder ↗"}</span>
        </p>
      </div>
    </div>
  );
}

function RenderRows() {
  const wide = [
    ["Enzo #1 × Lineup \"at Circuit\"", "P26-BDAY_enzo-siragusa-1_lineup1-on-sale_r1_9x16.mp4", "in", "Ready · 0:18 ▶"],
    ["Enzo #1 × Lineup \"turns 4\"", "P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16.mp4", "in", "Ready · 0:18 ▶"],
    ["Enzo #2 × Lineup \"at Circuit\"", "P26-BDAY_enzo-siragusa-2_lineup1-on-sale_r1_9x16.mp4", "fail", "Ready · 0:22 ▶"],
    ["Enzo #5 × Lineup \"at Circuit\"", "P26-BDAY_enzo-siragusa-5_lineup1-on-sale_r1_9x16.mp4", "file", "Ready · 0:15 ▶"],
    ["Enzo #5 × Lineup \"turns 4\"", "rendering", "run", "40 s left"],
  ] as const;
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium"><span className="max-[700px]:hidden">Round 1 · Enzo Siragusa · renders</span><span className="hidden max-[700px]:inline">Round 1 · renders</span></h3>
        <span className="text-xs text-muted-foreground"><span className="max-[700px]:hidden">9 of 11 ready · 2 rendering</span><span className="hidden max-[700px]:inline">9 of 11 ready</span></span>
      </div>
      {wide.map(([name, sub, mark, side]) => (
        <div key={name} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-border py-1.5">
          <span className="h-7 w-4 rounded bg-muted" />
          <div className="min-w-0">
            <p className="truncate text-sm"><span className="max-[700px]:hidden">{name}</span><span className="hidden max-[700px]:inline">{name.replace("Lineup ", "")}</span></p>
            <p className="text-[11px] text-muted-foreground">
              <span className="max-[700px]:hidden">{sub}</span>
              <span className="hidden max-[700px]:inline">{mark === "in" ? <InDriveMark /> : mark === "fail" || mark === "file" ? "Ready" : "40 s left"}</span>
            </p>
            {mark === "fail" ? <DriveFailed /> : null}
          </div>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {mark === "in" ? <span className="max-[700px]:hidden"><InDriveMark /></span> : null}
            <span className="max-[700px]:hidden">{side}</span>
            <span className="hidden max-[700px]:inline">{mark === "run" ? "" : side.replace("Ready · ", "")}</span>
          </span>
        </div>
      ))}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground"><span className="max-[700px]:hidden">+ 6 more — 5 ready, 1 rendering</span><span className="hidden max-[700px]:inline">+ 6 more</span></span>
        <button type="button" className="rounded bg-foreground px-2 py-1 text-xs text-background">Launch round 1</button>
      </div>
    </div>
  );
}

const ARTISTS = [{ id: "enzo", name: "Enzo Siragusa" }];
const PDF = preselectFolder({ name: "Puzzle-4th-set-times-v3.pdf" }, { artists: ARTISTS, status: "on_sale", eventDate: "2026-12-27", today: TODAY, calendar: CAL });
const CLIP = preselectFolder({ name: "enzo-boiler-room-2025.mp4", fromClips: true, artistId: "enzo" }, { artists: ARTISTS, status: "on_sale", eventDate: "2026-12-27", today: TODAY, calendar: CAL });

function FolderQuestion({ file, selected }: { file: { name: string; bytes: number }; selected: FolderChoice }) {
  const choices = usualFolders({ artists: ARTISTS, status: "on_sale", eventDate: "2026-12-27", today: TODAY, calendar: CAL }, selected);
  return (
    <WhichFolder
      fileLabel={`${file.name} · ${formatFileSize(file.bytes)}`}
      choices={choices}
      selectedKey={selected.key}
      artists={ARTISTS}
      onSelect={() => undefined}
      onCancel={() => undefined}
      onUpload={() => undefined}
    />
  );
}

export function DriveFrames({ id }: { id: string }) {
  if (id === "CLS5") {
    return (
      <div data-frame-ready={id} className="space-y-3 bg-background p-4 text-foreground">
        <Head />
        <RenderRows />
      </div>
    );
  }
  if (id === "CLS5b") {
    return (
      <div data-frame-ready={id} className="relative space-y-3 bg-background p-4 text-foreground">
        <div className="opacity-50"><Head /></div>
        <div className="max-[700px]:hidden"><div className="ml-auto w-[340px]"><DrivePanel folderName="2026-12-27 Puzzle 4th Birthday [P26-BDAY]" place="Off / Pixel › Puzzle" rows={ROWS} openUrl="https://drive.google.com/drive/folders/event" stateLine="Not shared" asking={null} /></div></div>
        <div className="hidden max-[700px]:block"><DrivePanel folderName="2026-12-27 Puzzle 4th Birthday [P26-BDAY]" place="Off / Pixel › Puzzle" rows={ROWS} openUrl="https://drive.google.com/drive/folders/event" stateLine="Not shared" asking={null} /></div>
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
      <div data-frame-ready={id} className="space-y-3 bg-background p-4 text-foreground">
        <div className="rounded-md border border-border bg-card p-3">
          <LabSource eventName="Puzzle 4th Birthday" rows={rows} tabs />
          <p className="mt-2 text-xs text-muted-foreground max-[700px]:hidden">+ 5 more finished renders · round 1</p>
        </div>
        <div className="max-w-[640px] rounded-md border border-border bg-card p-3 max-[700px]:hidden">
          <LabSource eventName="Puzzle 4th Birthday" rows={[]} empty tabs heading={false} />
        </div>
      </div>
    );
  }
  if (id === "CLS7") {
    return (
      <div data-frame-ready={id} className="relative space-y-3 bg-background p-4 text-foreground">
        <div className="opacity-60"><Head /></div>
        <div className="mx-auto max-w-[540px] max-[700px]:hidden">
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
      <div data-frame-ready={id} className="space-y-3 bg-background p-4 text-foreground">
        <Head setup />
        <div className="rounded-md border border-border bg-card p-3">
          <div className="max-[700px]:hidden">
            <DriveSetup treePath="Off / Pixel › Puzzle › 2026-12-27 Puzzle 4th Birthday [P26-BDAY]" resolved={{ name: "Puzzle Video", fileCount: 46, place: "Off / Pixel › Puzzle" }} error={null} link="https://drive.google.com/drive/folders/1kPzV…" onLinkChange={() => undefined} onResolve={() => undefined} onLink={() => undefined} onCreate={() => undefined} />
          </div>
          <div className="hidden max-[700px]:block">
            <DriveSetup treePath="Off / Pixel › Puzzle › 2026-12-27 Puzzle 4th Birthday [P26-BDAY]" resolved={null} error="Can't open that folder — share it with the export account or move it into Off / Pixel, then link it again." link="https://drive.google.com/drive/folders/1kPzV…" onLinkChange={() => undefined} onResolve={() => undefined} onLink={() => undefined} onCreate={() => undefined} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div data-frame-ready={id} className="bg-background p-4 text-foreground">
      <div className="rounded-md border border-border bg-card p-3">
        <DriveAssetBoard
          summary="7 approved · 2 missing"
          footnote="Artist card · 4:5 opens in Drive: 03 Creatives / 1 Signup / Announcement. Dropping the piece into 01 Open files queues the kit audit; the cell fills when it passes."
          rows={[
            { name: "Headliner UGC · promoter voice", narrowName: "UGC · promoter", cells: [
              { text: "Enzo #2", kind: "approved", driveFileId: "ugc" },
              { text: "—", kind: "na" },
              { text: "—", kind: "na" },
              { text: "—", kind: "na" },
            ] },
            { name: "Artist card", sub: "A–Z, press shot", narrowName: "Artist card", cells: [
              { text: "+ audio 15 s", textNarrow: "+ audio", kind: "made" },
              { text: "", kind: "approved", driveFileId: "card45", hot: true },
              { text: "", kind: "approved", driveFileId: "card11" },
              { text: "+ needs Reeshy's press shot", kind: "missing", drop: "drop it in 02 Source / Press kits / Reeshy", dropNarrow: "02 Source / Press kits / Reeshy" },
            ] },
            { name: "Lineup artwork edit", narrowName: "Lineup edit", cells: [
              { text: "+ needs the piece", kind: "missing", drop: "drop it in 01 Open files", dropNarrow: "01 Open files" },
              { text: "", kind: "approved", driveFileId: "line45" },
              { text: "", kind: "approved", driveFileId: "line11" },
              { text: "", kind: "made" },
            ] },
            { name: "Selling fast", sub: "true · approved", narrowName: "Selling fast", wideOnly: true, cells: [
              { text: "", kind: "approved", driveFileId: "sell916" },
              { text: "", kind: "approved", driveFileId: "sell45" },
              { text: "—", kind: "na" },
              { text: "—", kind: "na" },
            ] },
          ]}
        />
      </div>
    </div>
  );
}
