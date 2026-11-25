/**
 * MCP consent page shots (#1371). The runner opens /frames/mcp-consent/{id}.
 * Claude and loopback at 1280 and 393; the three other states at 393; and the
 * Claude page at 393 with prefers-color-scheme: dark (the app's tokens have
 * no dark values, so it should match the light page). The dark shot goes
 * through the lab path only for its `before` hook, which emulates the media.
 * Listed through event-config-shots.mjs while run.mjs sits in open PRs.
 */

const shot = (frame, width, suffix = "") => ({
  id: `MCP-consent-${frame}-${width}${suffix}`,
  frame: `mcp-consent/${frame}`,
  width,
  lab: false,
  before: null,
});

export const MCP_CONSENT_SHOTS = [
  shot("claude", 1280),
  shot("claude", 393),
  shot("loopback", 1280),
  shot("loopback", 393),
  shot("invalid", 393),
  shot("signed-out", 393),
  shot("not-operator", 393),
  // M2: grants that include drafts.
  shot("claude-drafts", 1280),
  shot("claude-drafts", 393),
  shot("loopback-drafts", 1280),
  shot("loopback-drafts", 393),
  shot("claude-upgrade", 1280),
  shot("claude-upgrade", 393),
  // M3a (MW1): a new connection with Meta, and a drafts grant adding Meta.
  shot("claude-meta", 1280),
  shot("claude-meta", 393),
  shot("claude-meta-upgrade", 1280),
  shot("claude-meta-upgrade", 393),
  {
    ...shot("claude", 393, "-dark"),
    lab: true,
    before: async (page) => {
      await page.emulateMedia({ colorScheme: "dark" });
    },
  },
];
