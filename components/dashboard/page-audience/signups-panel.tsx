"use client";

import { useSearchParams } from "next/navigation";

import {
  pickPanelPeriod,
  type PanelPeriod,
  type PanelStep,
  type SignupsBlock,
  type SignupsPanelModel,
  type SignupsPanelsByView,
} from "@/lib/dashboard/page-audience-panel/model";

/**
 * E2 "Signups & communities" (HE2, HA2 / HB3): CIRQLIN's page audience on
 * the sales pages. Tiles are a two-up grid below 640 px and four across
 * from there (#1231 MB3, MB8). Every row wraps; nothing is wider than the
 * phone (MB1).
 */

const NOTE = "text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]";

function Tile({ step }: { step: PanelStep }) {
  return (
    <div className="min-w-0 rounded-md border border-border p-3" data-step={step.id}>
      <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{step.label}</p>
      {step.value != null ? (
        <p className="mt-1 text-xl font-medium tabular-nums sm:text-2xl">{step.value}</p>
      ) : null}
      {step.sub ? <p className={step.value == null ? "mt-1 text-sm [overflow-wrap:anywhere]" : "mt-0.5 text-xs [overflow-wrap:anywhere]"}>{step.sub}</p> : null}
      {step.source ? <p className={`mt-1 ${NOTE}`}>{step.source}</p> : null}
      {step.lines.map((line) => (
        <p key={line} className={`mt-1 ${NOTE}`} data-step-line>
          {line}
        </p>
      ))}
    </div>
  );
}

function Block({ block }: { block: SignupsBlock }) {
  return (
    <div className="mt-4 min-w-0" data-signups-block={block.kind}>
      {block.heading ? <h3 className="text-sm font-medium [overflow-wrap:anywhere]">{block.heading}</h3> : null}
      {block.notCounted ? (
        <p className={`mt-2 ${NOTE}`} data-not-counted>
          {block.notCounted}
        </p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))] sm:gap-3">
            {block.steps.map((s) => (
              <Tile key={s.id} step={s} />
            ))}
          </div>
          <div className="mt-3 flex min-w-0 flex-col gap-1 text-xs sm:flex-row sm:flex-wrap sm:gap-x-6">
            {block.marketing ? (
              <p className="min-w-0 [overflow-wrap:anywhere]" data-marketing>
                {block.marketing.line}
                {block.marketing.offered ? <span className="text-muted-foreground"> · {block.marketing.offered}</span> : null}
              </p>
            ) : null}
            {block.partner ? (
              <p className="min-w-0 [overflow-wrap:anywhere]" data-partner>
                {block.partner.line}
                <span className="text-muted-foreground"> · {block.partner.sub}</span>
              </p>
            ) : null}
          </div>
        </>
      )}
      <p className={`mt-2 ${NOTE}`} data-scope-line>
        {block.scopeLine} · {block.source}
      </p>
    </div>
  );
}

export function SignupsPanel({ model }: { model: SignupsPanelModel }) {
  return (
    <section className="mx-auto w-full min-w-0 max-w-6xl px-3 py-4 sm:px-6" data-panel="signups-communities">
      <h2 className="text-lg font-medium tracking-tight sm:text-xl">{model.title}</h2>
      {model.blocks.map((b, i) => (
        <Block key={`${b.kind}-${i}`} block={b} />
      ))}
    </section>
  );
}

/**
 * The sales pages: the panel follows the view and the period the dashboard
 * has open (`?show=`, `?period=`, which SalesDashboard writes), else the
 * page's initial ones.
 */
export function SignupsPanelUrl({ byView, initialViewId, initialPeriod }: { byView: SignupsPanelsByView; initialViewId: string; initialPeriod: PanelPeriod }) {
  const params = useSearchParams();
  const show = params.get("show")?.toLowerCase();
  const viewId = show && byView[show] ? show : initialViewId;
  const period = pickPanelPeriod(params.get("period"), initialPeriod);
  const model = byView[viewId]?.[period];
  if (!model || !model.blocks.length) return null;
  return <SignupsPanel model={model} />;
}
