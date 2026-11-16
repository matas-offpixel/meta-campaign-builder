import type { BudgetPanelModel } from "@/lib/dashboard/he-panels/budget-view";

/**
 * E6 objective split and budget, for a show or a client. The table scrolls
 * inside itself on a phone. The budget lines stack.
 */

const TH = "py-1 pr-3 font-normal whitespace-nowrap";
const TD = "py-1.5 pr-3 align-top whitespace-nowrap";

export function ObjectiveBudgetPanel({ model }: { model: BudgetPanelModel }) {
  return (
    <section className="mx-auto w-full min-w-0 max-w-6xl px-3 py-4 sm:px-6" data-panel="objective-budget">
      <h2 className="text-lg font-medium tracking-tight sm:text-xl">{model.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {model.scope} · {model.period}
      </p>
      {model.rows.length ? (
      <div className="mt-3 min-w-0 max-w-full overflow-x-auto">
        <table className="w-max min-w-full text-left text-xs" data-objective-table>
          <thead className="text-[11px] text-muted-foreground">
            <tr>
              <th className={TH}>Objective</th>
              <th className={TH}>Channel</th>
              <th className={`${TH} text-right`}>Spend</th>
              <th className={`${TH} text-right`}>Result</th>
              <th className={`${TH} text-right`}>Cost</th>
              <th className={`${TH} pr-0 text-right`}>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row, i) => (
              <tr key={`${row.objective}-${row.channel}-${i}`} className="border-t border-border">
                <td className={TD}>{row.objective}</td>
                <td className={TD}>{row.channel}</td>
                <td className={`${TD} text-right tabular-nums`}>{row.spend}</td>
                <td className={`${TD} text-right tabular-nums`}>{row.result}</td>
                <td className={`${TD} text-right tabular-nums`}>
                  {row.cost ?? "—"}
                  {row.costLabel ? <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">{row.costLabel}</span> : null}
                </td>
                <td className={`${TD} pr-0 text-right tabular-nums`}>{row.roas ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      ) : null}
      <ul className="mt-4 min-w-0 space-y-2" data-budget>
        {model.lines.map((line) => (
          <li key={line.label} className="flex min-w-0 items-baseline justify-between gap-3 border-t border-border pt-2 text-sm">
            <span className="min-w-0">
              <span className="font-medium">{line.label}</span>
              {line.note ? <span className="mt-0.5 block text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{line.note}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums">{line.value}</span>
          </li>
        ))}
      </ul>
      {model.totalNote ? <p className="mt-2 text-[11px] text-muted-foreground">{model.totalNote}</p> : null}
    </section>
  );
}
