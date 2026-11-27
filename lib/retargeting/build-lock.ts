/**
 * One retargeting build per event at a time, and the build's stop lines
 * (27 Nov, NX26-RUDIMENTAL: a call that ran past the client's wait was asked
 * again while it was still building). No imports, so the connector's tool
 * and the create path both read it.
 */

/**
 * PENDING DESIGN (27 Nov, speed over design): the build's own stop lines.
 * busy: a second build of the show while one runs; time: the build stopped
 * before the client's wait ran out (what's made is kept); tier: a tier with
 * no audience left isn't made (never a broad ad set); noTier: no tier could
 * be made, so nothing after the audiences is.
 */
export const RF_STOP_WORDS = {
  busy: (code: string) => `Refused: ${code} is already being built. Nothing was changed. Ask again in a few minutes.`,
  time: (code: string) => `${code} isn’t finished yet: what’s made so far is kept. Ask again to carry on.`,
  tierNotMade: (code: string, tier: string) => `${code} · Retargeting · ${tier} wasn’t made: none of its audiences could be made.`,
  noTier: (code: string) => `Nothing more was made for ${code}: no tier had an audience to build from. What’s made is kept; ask again once the audiences can be made.`,
} as const;

/** A build counts as running while its row says building and was saved within this (every audience saves it). Past it, a new build takes over. */
export const BUILD_LOCK_MS = 240_000;
/** A step isn't started with less than this left before the deadline (one audience: an 8 s lookup and its create). */
export const STEP_MARGIN_MS = 25_000;

export type BuildRowState = { state: string | null; updatedAt: string | null } | null;

/** Running now: the row says building and was saved inside BUILD_LOCK_MS. */
export function buildRunning(row: BuildRowState, nowMs: number): boolean {
  return Boolean(row && row.state === "building" && row.updatedAt && nowMs - Date.parse(row.updatedAt) < BUILD_LOCK_MS);
}

