"use client";

import { WhatWeAreTesting } from "@/components/dashboard/creative-section/what-we-are-testing";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  DRIVE_LINK,
  FILTER_HINT,
  LAB_LINK,
  LEAST_TITLE,
  SALES_TITLE,
  SIGNUP_TITLE,
  TIKTOK_TITLE,
  VIEW_AD,
  filterCreativeSection,
  type CreativeSectionModel,
  type TagChoice,
} from "@/lib/dashboard/creative-section";

const TH = "py-1 pr-3 font-normal whitespace-nowrap";
const THN = `${TH} text-right`;
const TD = "py-1.5 pr-3 align-top [overflow-wrap:anywhere]";
const TDN = "py-1.5 pr-3 text-right tabular-nums whitespace-nowrap align-top";
const NOTE = "mt-2 max-w-3xl text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]";

function Scroll({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 min-w-0 max-w-full overflow-x-auto">{children}</div>;
}

function Links({ viewAd, lab, drive, surface }: { viewAd: string | null; lab: string | null; drive: string | null; surface: "internal" | "share" }) {
  if (surface !== "internal" || (!viewAd && !lab && !drive)) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
      {viewAd ? (
        <a href={viewAd} target="_blank" rel="noreferrer" className="underline">
          {VIEW_AD}
        </a>
      ) : null}
      {lab ? (
        <a href={lab} className="underline">
          {LAB_LINK}
        </a>
      ) : null}
      {drive ? (
        <a href={drive} target="_blank" rel="noreferrer" className="underline">
          {DRIVE_LINK}
        </a>
      ) : null}
    </span>
  );
}

export function CreativePanel({ model }: { model: CreativeSectionModel }) {
  const [selected, setSelected] = useState<TagChoice[]>([]);
  const view = filterCreativeSection(model, selected);
  const groups = [...new Set(model.tags.map((tag) => tag.group))];
  function toggle(choice: TagChoice) {
    setSelected((current) => {
      const on = current.some((item) => item.dimension === choice.dimension && item.label === choice.label);
      return on ? current.filter((item) => item.dimension !== choice.dimension || item.label !== choice.label) : [...current, choice];
    });
  }
  return (
    <section className="mx-auto w-full min-w-0 max-w-6xl px-3 py-4 sm:px-6" data-panel="creatives" data-surface={model.surface}>
      <h2 className="text-lg font-medium tracking-tight sm:text-xl">{model.title}</h2>
      <p className={NOTE}>{model.source}</p>
      {model.empty ? <p className={NOTE}>{model.empty}</p> : null}

      {model.tags.length ? (
        <div className="mt-3 min-w-0" data-tag-filters>
          <p className="text-[11px] text-muted-foreground">{FILTER_HINT}</p>
          {groups.map((group) => (
            <div key={group} className="mt-2 min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {model.tags
                  .filter((tag) => tag.group === group)
                  .map((tag) => {
                    const on = selected.some((item) => item.dimension === tag.dimension && item.label === tag.label);
                    return (
                      <button
                        key={`${tag.dimension}:${tag.label}`}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle({ dimension: tag.dimension, label: tag.label })}
                        className={`max-w-full rounded-full border px-2 py-0.5 text-left text-[11px] [overflow-wrap:anywhere] ${on ? "border-foreground bg-foreground text-background" : "border-border text-foreground"}`}
                      >
                        {tag.label} · {tag.count}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
          {view.filterEmpty ? <p className={NOTE}>{view.filterEmpty}</p> : null}
        </div>
      ) : null}

      <div className="mt-4 min-w-0">
        <h3 className="text-sm font-medium [overflow-wrap:anywhere]">{FORMAT_HEADING}</h3>
        {view.formatEmpty ? (
          <p className={NOTE}>{view.formatEmpty}</p>
        ) : (
          <Scroll>
            <table className="w-max min-w-full text-left text-xs" data-format-scorecard>
              <thead className="text-[11px] text-muted-foreground">
                <tr>
                  <th className={TH}>Format</th>
                  <th className={THN}>Creatives</th>
                  <th className={THN}>Spend</th>
                  <th className={THN}>CTR</th>
                  <th className={THN}>Signups</th>
                  <th className={THN}>£ / signup</th>
                  <th className={THN}>Purchases</th>
                  <th className={`${THN} pr-0`}>£ / purchase</th>
                </tr>
              </thead>
              <tbody>
                {view.formats.map((row) => (
                  <tr key={row.format} className="border-t border-border">
                    <td className={TD}>{row.format}</td>
                    <td className={TDN}>{row.creatives}</td>
                    <td className={TDN}>{row.spend}</td>
                    <td className={TDN}>{row.ctr}</td>
                    <td className={TDN}>{row.signups}</td>
                    <td className={TDN}>{row.costPerSignup}</td>
                    <td className={TDN}>{row.purchases}</td>
                    <td className={`${TDN} pr-0`}>{row.costPerPurchase}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </div>

      <div className="mt-4 min-w-0" data-least-impact>
        <h3 className="text-sm font-medium">{LEAST_TITLE}</h3>
        <p className={NOTE}>{view.leastNote}</p>
        {view.leastEmpty ? (
          <p className={NOTE}>{view.leastEmpty}</p>
        ) : (
          <ul className="mt-2 min-w-0 space-y-1 text-xs">
            {view.least.map((row) => {
              const href = model.surface === "internal" ? row.href : null;
              return (
                <li key={row.key} className="min-w-0 [overflow-wrap:anywhere]">
                  {href ? (
                    <a href={href} className="underline">
                      {row.name}
                    </a>
                  ) : (
                    <span className="font-medium">{row.name}</span>
                  )}
                  {href || !row.detail || row.detail === row.name ? null : <span className="text-muted-foreground"> · {row.detail}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Ranked title={SIGNUP_TITLE} rows={view.signups} empty={view.signupEmpty} data="signups" word="signups" surface={model.surface} />
      <Ranked title={SALES_TITLE} rows={view.sales} empty={view.salesEmpty} data="sales" word="purchases" surface={model.surface} />

      <div className="mt-4 min-w-0">
        <h3 className="text-sm font-medium">{TIKTOK_TITLE}</h3>
        {view.tiktokEmpty ? (
          <p className={NOTE}>{view.tiktokEmpty}</p>
        ) : (
          <Scroll>
            <table className="w-max min-w-full text-left text-xs" data-tiktok-creatives>
              <thead className="text-[11px] text-muted-foreground">
                <tr>
                  <th className={TH}>Creative</th>
                  <th className={THN}>Spend</th>
                  <th className={THN}>Impr.</th>
                  <th className={THN}>Clicks</th>
                  <th className={THN}>CTR</th>
                  <th className={THN}>2-second</th>
                  <th className={`${THN} pr-0`}>Completion</th>
                </tr>
              </thead>
              <tbody>
                {view.tiktok.map((row) => (
                  <tr key={row.name} className="border-t border-border">
                    <td className={TD}>{row.name}</td>
                    <td className={TDN}>{row.spend}</td>
                    <td className={TDN}>{row.impressions}</td>
                    <td className={TDN}>{row.clicks}</td>
                    <td className={TDN}>{row.ctr}</td>
                    <td className={TDN}>{row.views2s}</td>
                    <td className={`${TDN} pr-0`}>{row.completion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </div>

      {model.surface === "share" && model.testing?.length ? <WhatWeAreTesting cards={model.testing} /> : null}
    </section>
  );
}

const FORMAT_HEADING = "Formats · signups inside signup campaigns · purchases inside purchase campaigns · cost where £500+ ran";

function Ranked({
  title,
  rows,
  empty,
  data,
  word,
  surface,
}: {
  title: string;
  rows: CreativeSectionModel["signups"];
  empty: string | null;
  data: string;
  word: "signups" | "purchases";
  surface: "internal" | "share";
}) {
  return (
    <div className="mt-4 min-w-0" data-ranked={data}>
      <h3 className="text-sm font-medium">{title}</h3>
      {empty ? (
        <p className={NOTE}>{empty}</p>
      ) : (
        <>
          <ul className="mt-2 min-w-0 space-y-3 sm:hidden">
            {rows.map((row) => (
              <li key={row.key} className="min-w-0 border-t border-border pt-2">
                <p className="font-medium [overflow-wrap:anywhere]">{row.name}</p>
                <p className="text-[11px] tabular-nums">
                  {row.result} {word} · {row.cost} each · {row.spend}
                </p>
                {row.tags ? <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{row.tags}</p> : null}
                <Links viewAd={row.viewAd} lab={row.lab} drive={row.drive} surface={surface} />
              </li>
            ))}
          </ul>
          <div className="hidden sm:block">
            <Scroll>
              <table className="w-max min-w-full text-left text-xs">
                <thead className="text-[11px] text-muted-foreground">
                  <tr>
                    <th className={TH}>Creative</th>
                    <th className={THN}>Spend</th>
                    <th className={THN}>Result</th>
                    <th className={THN}>Cost</th>
                    <th className={THN}>Impr.</th>
                    <th className={THN}>Clicks</th>
                    <th className={`${THN} pr-0`}>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-t border-border">
                      <td className={`${TD} min-w-0`}>
                        <span className="font-medium">{row.name}</span>
                        {row.tags ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{row.tags}</span> : null}
                        <Links viewAd={row.viewAd} lab={row.lab} drive={row.drive} surface={surface} />
                      </td>
                      <td className={TDN}>{row.spend}</td>
                      <td className={TDN}>{row.result}</td>
                      <td className={TDN}>{row.cost}</td>
                      <td className={TDN}>{row.impressions}</td>
                      <td className={TDN}>{row.clicks}</td>
                      <td className={`${TDN} pr-0`}>{row.ctr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          </div>
        </>
      )}
    </div>
  );
}

export function CreativeSectionUrl({ byView, initialViewId }: { byView: Record<string, CreativeSectionModel>; initialViewId: string }) {
  const params = useSearchParams();
  const show = params.get("show")?.toLowerCase();
  const viewId = show && byView[show] ? show : initialViewId;
  const model = byView[viewId];
  if (!model) return null;
  return <CreativePanel key={viewId} model={model} />;
}
