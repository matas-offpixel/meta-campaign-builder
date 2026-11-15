import type { PresalePanelModel } from "@/lib/dashboard/he-panels/presale-view";

import { PresaleForm } from "./presale-form";

/**
 * E3 presale log, one show. Each figure names its source. The entry form
 * is internal only. Rows stack, so a phone doesn't scroll the page sideways.
 */

export function PresalePanel({ model }: { model: PresalePanelModel }) {
  return (
    <section className="mx-auto w-full min-w-0 max-w-6xl px-3 py-4 sm:px-6" data-panel="presale">
      <h2 className="text-lg font-medium tracking-tight sm:text-xl">{model.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {model.show}
        {model.open ? ` · ${model.open}` : ""}
      </p>
      {model.prompt ? <p className="mt-3 text-sm">{model.prompt}</p> : null}
      <ul className="mt-3 min-w-0 space-y-3">
        {model.rows.map((row) => (
          <li key={row.label} className="min-w-0 border-t border-border pt-2">
            <p className="text-sm font-medium [overflow-wrap:anywhere]">{row.label}</p>
            <p className="text-sm tabular-nums">{row.value}</p>
            {row.source ? <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{row.source}</p> : null}
          </li>
        ))}
      </ul>
      {model.form ? <PresaleForm eventId={model.eventId} /> : null}
    </section>
  );
}
