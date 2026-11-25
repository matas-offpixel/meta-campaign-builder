/**
 * M4a frames from the records' own fixtures (2026-11-25-m4-render-templates
 * RT-A, RT-B; 2026-11-25-m4-renders-on-yes RY-A). Every figure is invented,
 * as the records' are; the views and words are the live code's.
 */
import type { MutedInputs, PackageState } from "@/lib/render-templates/package-view";
import type { RenderFileRow } from "@/lib/render-templates/report";

export const RENDER_PACKAGE_FRAME_IDS = ["rt-a-p26", "rt-a-es27", "rt-b", "ry-a", "ry-a-open"] as const;
export type RenderPackageFrameId = (typeof RENDER_PACKAGE_FRAME_IDS)[number];

const LINEUP = ["Enzo Siragusa", "Luke Dean", "Rossi.", "Seb Zito", "Archie Hamilton", "Josh Baker"].map((name, i) => ({ name, isHeadliner: i < 2 }));
const clip = (i: number, owner: "artist" | "promoter", clientName: string) => ({
  id: `c${owner}${i}`,
  name: `${owner === "artist" ? "Enzo - Raw" : "Puzzle crowd"} ${i}.mp4`,
  owner,
  clientId: owner === "artist" ? "electric" : "puzzle",
  clientName,
  artistName: owner === "artist" ? "Enzo Siragusa" : null,
  isHeadliner: true,
  inS: 0,
  outS: 9,
  driveFileId: null,
});

export const P26: PackageState = {
  event: { id: "ev-p26", code: "P26-BDAY", name: "Puzzle 4th Birthday", clientId: "puzzle", clientName: "Puzzle", stage: "on_sale", date: "2026-12-27", venue: "Circuit & Engine Rooms, Southampton" },
  lineup: LINEUP,
  clips: [...Array.from({ length: 11 }, (_, i) => clip(i + 1, "promoter", "Puzzle")), ...Array.from({ length: 5 }, (_, i) => clip(i + 1, "artist", "Electric Brixton"))],
  tracks: [{ id: "t1", name: "Track One", artistName: "Enzo Siragusa", dropS: 32, dropSource: "lab", durationS: 300, flagged: false, dropAtS: 3.8 }],
  kit: { ready: true },
  claim: { state: "ready", text: "3rd release live", lines: ["3rd release live"], readAt: "2026-11-25T09:00:00Z" },
};

export const P26_MUTED: MutedInputs = {
  rawClip: "Enzo - Raw 2.mp4",
  pressShot: "Enzo Siragusa.jpg",
  tracks: 1,
  snippets: 0,
  artwork: "PUZZLE BIRTHDAY 1 STORY",
  details: "Enzo Siragusa · Sun 27 Dec · Circuit & Engine Rooms, Southampton",
  artistName: "Enzo Siragusa",
};

export const ES27: PackageState = {
  event: { id: "ev-es27", code: "ES27-ENZOSIRAGUSA", name: "Enzo Siragusa", clientId: "electric", clientName: "Electric Brixton", stage: "signup", date: "2027-02-19", venue: "Electric Brixton, London" },
  lineup: [{ name: "Enzo Siragusa", isHeadliner: true }],
  clips: Array.from({ length: 5 }, (_, i) => clip(i + 1, "artist", "Electric Brixton")),
  tracks: [{ id: "t2", name: "Track One", artistName: "Enzo Siragusa", dropS: null, dropSource: null, durationS: 300, flagged: false, dropAtS: null }],
  kit: { ready: false },
  claim: { state: "none", text: null, lines: [], readAt: null },
};

export const ES27_MUTED: MutedInputs = { ...P26_MUTED, details: "Enzo Siragusa · Fri 19 Feb · Electric Brixton, London" };

const row = (fileName: string, over: Partial<RenderFileRow>): RenderFileRow => ({
  id: fileName,
  fileName,
  status: "done",
  round: 1,
  recipe: "montage",
  shareable: false,
  heldReason: "filmed",
  checks: { passed: true, failed: [] },
  driveFileId: "1Zs918KNjqvLzWQdZ7mB5FUvVrq8TAaPZ",
  ...over,
});

export const RT_B_ROWS: RenderFileRow[] = [
  row("P26-BDAY__promoter-puzzle__montage__teaser__tickets__r1__9x16.mp4", {}),
  row("P26-BDAY__promoter-puzzle__montage__announcement__tickets__r1__9x16.mp4", {}),
  row("P26-BDAY__promoter-puzzle__montage__no-text__no-cta__r1__4x5.mp4", { checks: { passed: false, failed: ["format"] } }),
  row("P26-BDAY__promoter-puzzle__montage__no-text__no-cta__r1__1x1.mp4", { status: "rendering", checks: null, driveFileId: null }),
];

const files = (n: number, done: number, failedAt: number | null): RenderFileRow[] =>
  Array.from({ length: n }, (_, i) =>
    row(`f${i}.mp4`, i < done ? (i === failedAt ? { checks: { passed: false, failed: ["format"] } } : {}) : { status: "rendering", checks: null, driveFileId: null }),
  );

export const RY_A = {
  glitter: { pkg: { id: "g", eventCode: "NX27-GLITTERBOX", eventId: "ev-g", recipes: ["montage" as const], fileCount: 9, status: "rendering" as const, approvalAsked: "Render the NX27-GLITTERBOX montage: 9 files. OK?", approvalAnswer: "yes", approvedAt: "2026-11-25T15:24:00Z", createdAt: "2026-11-25T15:24:00Z" }, files: files(9, 4, null) },
  p26: {
    pkg: {
      id: "p",
      eventCode: "P26-BDAY",
      eventId: "ev-p26",
      recipes: ["montage" as const],
      fileCount: 9,
      status: "done" as const,
      approvalAsked: "Render the P26-BDAY montage: 9 files (no text, teaser, announcement × 9:16, 4:5, 1:1). 16 clips : 11 filmed by Puzzle, 5 Enzo Siragusa’s. Claim: 3rd release live. Drop at 3.8 s. Files that pass the checks can be uploaded. OK?",
      approvalAnswer: "yes",
      approvedAt: "2026-11-25T15:10:00Z",
      createdAt: "2026-11-25T15:10:00Z",
    },
    files: files(9, 9, 7),
  },
  refused: [
    { id: "r1", eventCode: "ES27-ENZOSIRAGUSA", recipes: ["montage" as const], files: 9, refused: "promoter", line: "Refused · Puzzle’s footage in the picks" },
    { id: "r2", eventCode: "NX27-GLITTERBOX", recipes: ["artist-card" as const], files: 6, refused: "voice", line: "Refused · artist-voice copy with no approved caption" },
    { id: "r3", eventCode: "P26-BDAY", recipes: ["montage" as const, "roll-call" as const, "top-tracks" as const, "artist-card" as const], files: 33, refused: "cap", line: "Refused · over the 24-file cap" },
  ],
};
