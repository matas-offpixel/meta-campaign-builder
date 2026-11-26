/**
 * Claude's Meta changes on Today: MB-A and MB-B (record
 * 2026-11-26-mcp-m3b-today), FC-A and FC-B (2026-11-25-mcp-full-control),
 * at 1280 and 393. The runner opens /frames/mcp-today/{id}. Listed through
 * event-config-shots.mjs while run.mjs sits in open PRs.
 */

const FRAMES = [
  ["M3B-MB-A", "mb-a"],
  ["M3B-MB-B", "mb-b"],
  ["M3B-FC-A", "fc-a"],
  ["M3B-FC-B", "fc-b"],
];

export const MCP_TODAY_SHOTS = FRAMES.flatMap(([id, frame]) =>
  [1280, 393].map((width) => ({ id: `${id}-${width}`, frame: `mcp-today/${frame}`, width, lab: false, before: null })),
);
