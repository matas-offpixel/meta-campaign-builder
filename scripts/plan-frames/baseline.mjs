import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";

/**
 * Check mode never creates a file. UPDATE always writes.
 * A missing dest in check mode is a failure, not a write.
 */
export function classifyShot({ destExists, update }) {
  if (update) return "write";
  if (!destExists) return "missing";
  return "compare";
}

export function missingBaselineLine(id) {
  return `MISSING ${id} — no baseline committed; run frames-baselines.yml and commit docs/frames/${id}.png`;
}

/**
 * Apply the write / missing / compare decision for one shot.
 * Check mode leaves a missing dest untouched and reports it.
 */
export async function applyShot({ dest, png, update, id }) {
  const action = classifyShot({ destExists: existsSync(dest), update });
  if (action === "missing") {
    return { failed: true, wrote: false, line: missingBaselineLine(id) };
  }
  if (action === "write") {
    await writeFile(dest, png);
    return { failed: false, wrote: true, line: null };
  }
  return { failed: false, wrote: false, line: null };
}

export function foldShots(results) {
  const failed = results.some((result) => result.failed);
  return { failed, exitCode: failed ? 1 : 0 };
}
