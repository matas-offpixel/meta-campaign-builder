"use client";

import { cleanLine, countLine } from "@/lib/launch-guard/check";
import type { LaunchCheck, LaunchCheckFix, LaunchGuardResult } from "@/lib/launch-guard/types";

/**
 * Review & launch's launch checks (record 2026-11-24-campaign-creator-replicate,
 * RC3, frame RC-C). The count line, then each check — key word, sentence,
 * evidence, the fixes it offers — blockers first in the order the checks
 * run, then warnings. Clean: "● Nothing to fix" and the match line.
 * Colour is brick for a blocker, ochre for a warning, olive when clean,
 * always with the words. Every string comes from lib/launch-guard/words.ts.
 */
export function LaunchChecks({
  result,
  onFix,
}: {
  result: LaunchGuardResult;
  /** Absent: read-only (the plan canvas owns Launch); fixes aren't drawn. */
  onFix?: (check: LaunchCheck, fix: LaunchCheckFix) => void;
}) {
  const lines = countLine(result);
  const clean = result.blockers === 0 && result.warnings === 0;
  return (
    <section aria-label="Launch checks" data-launch-checks="" className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em]">
        {clean ? (
          <span className="text-success">{lines[0]}</span>
        ) : (
          <>
            {result.blockers > 0 ? <span className="text-destructive">{lines[0]}</span> : null}
            {result.warnings > 0 ? (
              <span className="text-warning-foreground">{lines[result.blockers > 0 ? 1 : 0]}</span>
            ) : null}
          </>
        )}
      </div>
      {clean ? <p className="text-[13px] text-foreground">{cleanLine(result.eventCode)}</p> : null}
      {result.checks.map((check, index) => (
        <CheckRow key={`${check.key}-${index}`} check={check} onFix={onFix} />
      ))}
    </section>
  );
}

function CheckRow({
  check,
  onFix,
}: {
  check: LaunchCheck;
  onFix?: (check: LaunchCheck, fix: LaunchCheckFix) => void;
}) {
  const warning = check.severity === "warning";
  return (
    <div
      data-launch-check={check.key}
      className={`rounded-md border border-l-4 border-border-strong bg-background px-3 py-2.5 text-[13px] ${
        warning ? "border-l-warning" : "border-l-destructive"
      }`}
    >
      <div
        className={`mb-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${
          warning ? "text-warning-foreground" : "text-destructive"
        }`}
      >
        {check.label}
      </div>
      <p className="font-semibold leading-snug text-foreground">{check.sentence}</p>
      {check.evidence ? <p className="mb-1.5 mt-1 text-[11.5px] text-muted-foreground">{check.evidence}</p> : null}
      {onFix && check.fixes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {check.fixes.map((fix) => (
            <button
              key={fix.label}
              type="button"
              onClick={() => onFix(check, fix)}
              className="rounded border border-foreground bg-transparent px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-foreground hover:bg-muted"
            >
              {fix.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
