/**
 * Baselines change only after a design PASS (docs/design-record/README.md).
 * A PR that adds, changes or deletes docs/frames/*.png fails here unless it
 * carries the `design-pass` label, which Matas adds after the PASS.
 *
 *   PR_NUMBER=… GH_REPO=owner/name LABELS='["a","b"]' node scripts/ci/design-pass-guard.mjs
 *
 * Reads the PR's file list with `gh` (GH_TOKEN in the environment).
 */

import { execFileSync } from "node:child_process";

export const DESIGN_PASS_LABEL = "design-pass";

/** Committed baselines only: docs/frames/<id>.png, not docs/frames/local/. */
export function changedBaselines(files) {
  return files.filter((file) => /^docs\/frames\/[^/]+\.png$/.test(file));
}

export function guardLine({ files, labels }) {
  const frames = changedBaselines(files);
  if (frames.length === 0) return { ok: true, line: "No frame baselines changed." };
  if (labels.includes(DESIGN_PASS_LABEL)) {
    return { ok: true, line: `${frames.length} frame baselines changed; ${DESIGN_PASS_LABEL} is on the PR.` };
  }
  return {
    ok: false,
    line: [
      `${frames.length} frame baselines changed without the ${DESIGN_PASS_LABEL} label:`,
      ...frames.map((file) => `  ${file}`),
      `Baselines change only after a design PASS naming these frames. Matas adds ${DESIGN_PASS_LABEL} after the PASS.`,
    ].join("\n"),
  };
}

function main() {
  const number = process.env.PR_NUMBER;
  if (!number) {
    console.log("Not a pull request; nothing to check.");
    return;
  }
  const labels = JSON.parse(process.env.LABELS || "[]");
  const repo = process.env.GH_REPO;
  const out = execFileSync(
    "gh",
    ["api", `repos/${repo}/pulls/${number}/files`, "--paginate", "--jq", ".[].filename"],
    { encoding: "utf8" },
  );
  const files = out.split("\n").map((line) => line.trim()).filter(Boolean);
  const result = guardLine({ files, labels });
  (result.ok ? console.log : console.error)(result.line);
  if (!result.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
