import type { GeographyModel } from "@/lib/dashboard/page-audience-panel/model";

/**
 * E1's first-party half (HE2, PA6): where the signups are, from CIRQLIN,
 * drawn inside "Who we reached" beside Meta's tables and never blended
 * with them. The umbrella page is its own list.
 */

const NOTE = "mt-2 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]";

export function SignupGeography({ model }: { model: GeographyModel }) {
  return (
    <div className="min-w-0" data-signup-geography>
      <h3 className="text-sm font-medium [overflow-wrap:anywhere]">{model.title}</h3>
      {model.blocks.map((b, i) => (
        <div key={`${b.kind}-${i}`} className={i ? "mt-5 min-w-0" : "min-w-0"} data-geography-block={b.kind}>
          {b.heading ? <p className="mt-2 text-xs font-medium [overflow-wrap:anywhere]">{b.heading}</p> : null}
          {b.rows ? (
            <ul className="mt-2 text-xs">
              {b.rows.map((r) => (
                <li key={`${r.kind}-${r.label}`} className="flex items-baseline justify-between gap-3 border-t border-border py-1.5" data-geo-row={r.kind}>
                  <span className={`min-w-0 [overflow-wrap:anywhere] ${r.kind === "city" ? "" : "text-muted-foreground"}`}>{r.label}</span>
                  <span className="shrink-0 tabular-nums">{r.value}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs" data-withheld>
              {b.withheld}
            </p>
          )}
          {b.note ? (
            <p className={NOTE} data-geography-note>
              {b.note}
            </p>
          ) : null}
          <p className={NOTE}>{b.footnote}</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{b.source}</p>
        </div>
      ))}
    </div>
  );
}
