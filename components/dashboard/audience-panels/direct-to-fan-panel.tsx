"use client";

import Link from "next/link";
import { useState } from "react";

import type { ChannelRow, DirectToFanModel, PhoneCost } from "@/lib/dashboard/direct-to-fan";

/**
 * E5 "Direct-to-fan" (HE3): WhatsApp vs email by channel, clicks as the
 * comparison (EV4), and the sends behind it. The raw email open rate is
 * never drawn (PI4). "Rate not set" is internal only and links to the
 * client's rate field (PI5). On a phone the channel table becomes EV4's
 * 393 list; the sends table scrolls inside its own row (#1231).
 */

const TH = "py-1 pr-3 font-normal whitespace-nowrap";
const THN = `${TH} text-right`;
const TD = "py-1.5 pr-3 whitespace-nowrap";
const TDN = `${TD} text-right tabular-nums`;
const NOTE = "mt-2 max-w-3xl text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]";

/** Sends drawn before "Show all". */
export const SENDS_SHOWN = 8;

function Cost({ row, href }: { row: ChannelRow; href: string | null }) {
  if (!row.rateNotSet) return <>{row.costText}</>;
  return href ? (
    <Link href={href} className="text-muted-foreground underline decoration-dotted underline-offset-2" data-rate-not-set>
      {row.costText}
    </Link>
  ) : (
    <span className="text-muted-foreground" data-rate-not-set>
      {row.costText}
    </span>
  );
}

function ChannelTable({ model }: { model: DirectToFanModel }) {
  return (
    <div className="mt-2 hidden min-w-0 max-w-full overflow-x-auto sm:block">
      <table className="w-full text-left text-xs" data-d2c-channels>
        <thead className="text-[11px] text-muted-foreground">
          <tr>
            <th className={TH}>Channel</th>
            <th className={THN}>Sends</th>
            <th className={THN}>Delivered</th>
            <th className={THN}>Read / opened</th>
            <th className={THN}>Clicked</th>
            <th className={THN}>Click rate</th>
            <th className={THN}>Cost</th>
            <th className={`${THN} pr-0`}>£ / click</th>
          </tr>
        </thead>
        <tbody>
          {model.channels.map((row) => (
            <tr key={row.group} className="border-t border-border">
              <td className={TD}>{row.label}</td>
              <td className={TDN}>{row.sendsText}</td>
              <td className={TDN}>{row.deliveredText}</td>
              <td className={TDN}>{row.readOpenedText}</td>
              <td className={TDN}>{row.clickedText}</td>
              <td className={TDN}>{row.clickRateText}</td>
              <td className={TDN}>
                <Cost row={row} href={model.rateHref} />
              </td>
              <td className={`${TDN} pr-0`}>{row.costPerClickText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PhoneCostLine({ costs, href }: { costs: PhoneCost[]; href: string | null }) {
  if (!costs.length) return null;
  return (
    <p className="mt-2 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]" data-d2c-phone-costs>
      {costs.map((c, i) => (
        <span key={c.label}>
          {i ? " · " : ""}
          {c.label}{" "}
          {c.rateNotSet && href ? (
            <Link href={href} className="underline decoration-dotted underline-offset-2" data-rate-not-set>
              {c.text}
            </Link>
          ) : (
            c.text
          )}
        </span>
      ))}
    </p>
  );
}

function PhoneRates({ model }: { model: DirectToFanModel }) {
  const max = Math.max(...model.phone.rates.map((r) => r.clickRate ?? 0), 0);
  return (
    <div className="mt-2 sm:hidden" data-d2c-phone>
      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{model.phone.title}</p>
      <ul className="mt-2 space-y-2">
        {model.phone.rates.map((r) => (
          <li key={r.label} className="text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 tabular-nums">{r.rateText}</span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-sm bg-muted">
              <div className="h-1.5 rounded-sm bg-foreground" style={{ width: `${max > 0 ? ((r.clickRate ?? 0) / max) * 100 : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <PhoneCostLine costs={model.phone.costs} href={model.rateHref} />
    </div>
  );
}

function SendsTable({ model }: { model: DirectToFanModel }) {
  const [all, setAll] = useState(false);
  if (!model.sends.length) return null;
  const rows = all ? model.sends : model.sends.slice(0, SENDS_SHOWN);
  return (
    <div className="mt-6">
      <h3 className="text-sm font-medium">Sends</h3>
      <div className="mt-2 min-w-0 max-w-full overflow-x-auto">
        <table className="w-max min-w-full text-left text-xs" data-d2c-sends>
          <thead className="text-[11px] text-muted-foreground">
            <tr>
              <th className={TH}>Sent</th>
              {model.nameColumn ? <th className={TH}>Send</th> : null}
              {model.showColumn ? <th className={TH}>Show</th> : null}
              <th className={TH}>Channel</th>
              <th className={THN}>Delivered</th>
              <th className={THN}>Read / opened</th>
              <th className={THN}>Clicked</th>
              <th className={`${THN} pr-0`}>Click rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className={`${TD} text-muted-foreground`}>{s.dayText}</td>
                {model.nameColumn ? (
                  <td className={`${TD} max-w-[22rem] truncate`} title={s.name}>
                    {s.name}
                  </td>
                ) : null}
                {model.showColumn ? <td className={TD}>{s.showText}</td> : null}
                <td className={TD}>{s.channelText}</td>
                <td className={TDN}>{s.deliveredText}</td>
                <td className={TDN}>{s.readOpenedText}</td>
                <td className={TDN}>{s.clickedText}</td>
                <td className={`${TDN} pr-0`}>{s.clickRateText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {model.sends.length > SENDS_SHOWN ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-[11px] underline underline-offset-2" aria-expanded={all}>
          {all ? "Show the latest" : `Show all ${model.sends.length.toLocaleString("en-GB")} sends`}
        </button>
      ) : null}
    </div>
  );
}

export function DirectToFanPanel({ model }: { model: DirectToFanModel }) {
  return (
    <section className="mx-auto w-full min-w-0 max-w-6xl px-3 py-4 sm:px-6" data-panel="direct-to-fan">
      <h2 className="text-lg font-medium tracking-tight sm:text-xl">{model.title}</h2>
      {model.empty ? (
        <p className={NOTE}>{model.empty}</p>
      ) : (
        <>
          <h3 className="mt-4 text-sm font-medium [overflow-wrap:anywhere]">{model.tableTitle}</h3>
          <ChannelTable model={model} />
          <PhoneRates model={model} />
          {model.headline ? <p className="mt-3 max-w-3xl text-[13px] leading-snug [overflow-wrap:anywhere]">{model.headline}</p> : null}
          <p className={NOTE} data-d2c-totals>
            {model.totalsLine}
          </p>
          {model.footnote ? <p className="mt-1 max-w-3xl text-[11px] leading-snug text-muted-foreground">{model.footnote}</p> : null}
          <SendsTable model={model} />
        </>
      )}
      {model.reviewLine ? (
        <p className="mt-3 text-[11px] text-muted-foreground" data-d2c-review>
          {model.reviewLine}
        </p>
      ) : null}
    </section>
  );
}
