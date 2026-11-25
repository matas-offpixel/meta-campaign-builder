/**
 * M4a render-package shots (records 2026-11-25-m4-render-templates RT-A,
 * RT-B; 2026-11-25-m4-renders-on-yes RY-A; 2026-11-25-m4a-words MA-A), at
 * 1280 and 393. The runner opens /frames/render-package/{id}. The consent
 * page's MA-B frames are MCP-consent-claude-render(-upgrade) in
 * mcp-consent-shots.mjs. Listed through event-config-shots.mjs while run.mjs
 * sits in open PRs.
 */

const FRAMES = [
  ["M4-RT-A-P26", "rt-a-p26"],
  ["M4-RT-A-ES27", "rt-a-es27"],
  ["M4-RT-B", "rt-b"],
  ["M4-RY-A", "ry-a"],
  ["M4-RY-A-open", "ry-a-open"],
  ["M4-MA1-busy", "ma1-busy"],
  ["M4-MA1-too-soon", "ma1-too-soon"],
  ["M4-MA4-not-filed", "ma4-not-filed"],
];

export const RENDER_PACKAGE_SHOTS = FRAMES.flatMap(([id, frame]) =>
  [1280, 393].map((width) => ({ id: `${id}-${width}`, frame: `render-package/${frame}`, width, lab: false, before: null })),
);
