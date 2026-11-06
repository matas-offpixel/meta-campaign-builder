/**
 * The index of the frames evidence pack: which file is which frame, at
 * which width, and what the check said about it.
 */

const STATUS_WORD = {
  ok: "matches baseline",
  written: "baseline written",
  missing: "no baseline",
  diff: "over tolerance",
  resized: "size changed",
};

/**
 * @param {{ id: string; frame: string; width: number; shot: string; status: keyof typeof STATUS_WORD; diffPct: number | null; diff: { dir: string; expected: string; actual: string; hasDiffImage: boolean } | null }[]} rows
 * @param {{ tolerance: number; sha: string | null }} meta
 */
export function evidenceIndex(rows, meta) {
  const changed = rows.filter((row) => row.status === "diff" || row.status === "resized");
  const pct = (meta.tolerance * 100).toFixed(1);
  const json = {
    sha: meta.sha,
    tolerancePct: meta.tolerance * 100,
    shots: rows.map((row) => ({
      file: row.shot,
      frame: row.frame,
      width: row.width,
      status: row.status,
      diffPct: row.diffPct,
      diff: row.diff
        ? {
            expected: `${row.diff.dir}/expected.png`,
            actual: `${row.diff.dir}/actual.png`,
            diff: row.diff.hasDiffImage ? `${row.diff.dir}/diff.png` : null,
            expectedSize: row.diff.expected,
            actualSize: row.diff.actual,
          }
        : null,
    })),
  };
  const head = meta.sha ? `Head ${meta.sha}. ` : "";
  const lines = [
    "# Frames evidence",
    "",
    `${head}${rows.length} shots, ${changed.length} over the ${pct}% tolerance.`,
    "",
    "| File | Frame | Width | Check |",
    "|---|---|---|---|",
    ...rows.map((row) => {
      const word = STATUS_WORD[row.status] ?? row.status;
      let extra = "";
      if (row.status === "diff") extra = ` ${row.diffPct}% — \`${row.diff.dir}/\``;
      if (row.status === "resized") extra = ` ${row.diff.expected} → ${row.diff.actual} — \`${row.diff.dir}/\``;
      return `| \`${row.shot}\` | ${row.frame} | ${row.width} | ${word}${extra} |`;
    }),
    "",
  ];
  return { json, markdown: lines.join("\n") };
}
