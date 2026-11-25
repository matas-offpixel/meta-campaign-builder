"use client";

import { cleanLine, countLine } from "@/lib/launch-guard/check";
import { codeSpans } from "@/lib/launch-guard/code-spans";
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
  keptLines = [],
}: {
  result: LaunchGuardResult;
  /** "Link kept by {name}, {date, time}: {url}", one muted line each, under the list (RC3). */
  keptLines?: readonly string[];
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
      {clean ? (
        <p className="text-[13px] text-foreground">
          <NoBreakCodes text={cleanLine(result.eventCode)} />
        </p>
      ) : null}
      {result.checks.map((check, index) => (
        <CheckRow key={`${check.key}-${index}`} check={check} onFix={onFix} />
      ))}
      {keptLines.map((line) => (
        <p key={line} data-launch-kept="" className="text-[11.5px] text-muted-foreground">
          <NoBreakCodes text={line} />
        </p>
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
      <p className="font-semibold leading-snug text-foreground">
        <NoBreakCodes text={check.sentence} />
      </p>
      {check.evidence ? (
        <p className="mb-1.5 mt-1 text-[11.5px] text-muted-foreground">
          <NoBreakCodes text={check.evidence} />
        </p>
      ) : null}
      {onFix && check.fixes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {check.fixes.map((fix) => (
            <button
              key={fix.label}
              type="button"
              onClick={() => onFix(check, fix)}
              className="rounded border border-foreground bg-transparent px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-foreground hover:bg-muted"
            >
              <FixLabel label={fix.label} names={fix.names} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A fix button's label. The button sets its words in capitals; a page
 * name, handle or account name inside it keeps its own case (RC8):
 * "USE THE LIVE ADS' INSTAGRAM: @dj_dod".
 */
export function FixLabel({ label, names }: { label: string; names?: readonly string[] }) {
  const parts: Array<{ text: string; name: boolean }> = [{ text: label, name: false }];
  for (const name of names ?? []) {
    if (!name) continue;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!;
      if (part.name) continue;
      const at = part.text.indexOf(name);
      if (at < 0) continue;
      parts.splice(
        i,
        1,
        { text: part.text.slice(0, at), name: false },
        { text: name, name: true },
        { text: part.text.slice(at + name.length), name: false },
      );
      break;
    }
  }
  return (
    <>
      {parts
        .filter((part) => part.text)
        .map((part, index) =>
          part.name ? (
            <span key={index} className="normal-case">
              <NoBreakCodes text={part.text} />
            </span>
          ) : (
            <span key={index}>
              <NoBreakCodes text={part.text} />
            </span>
          ),
        )}
    </>
  );
}

/**
 * The text with each event code, pixel ending and domain set nowrap, so the
 * line wraps before one, never inside it (lib/launch-guard/code-spans.ts).
 */
export function NoBreakCodes({ text }: { text: string }) {
  return (
    <>
      {codeSpans(text).map((span, index) =>
        span.whole ? (
          <span key={index} data-nowrap="" className="whitespace-nowrap">
            {span.text}
          </span>
        ) : (
          span.text
        ),
      )}
    </>
  );
}
