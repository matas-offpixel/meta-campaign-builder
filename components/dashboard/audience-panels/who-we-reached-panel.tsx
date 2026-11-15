import type { MetaAgeRow, MetaRegionRow, TikTokRow, WhoWeReachedModel } from "@/lib/dashboard/who-we-reached";

/**
 * E1 "Who we reached" (HE1): Meta results by age, Meta delivery by region,
 * and TikTok delivery by age and UK nation. Same on the internal page and
 * the share link (E7: client-visible). Wide tables scroll inside their own
 * row on a phone, never the page (#1231).
 */

const TH = "py-1 pr-3 font-normal whitespace-nowrap";
const THN = `${TH} text-right`;
const TD = "py-1.5 pr-3 whitespace-nowrap";
const TDN = `${TD} text-right tabular-nums`;

function Scroll({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 min-w-0 max-w-full overflow-x-auto">{children}</div>;
}

function MetaAgeTable({ rows, total }: { rows: MetaAgeRow[]; total: MetaAgeRow }) {
  return (
    <Scroll>
      <table className="w-max min-w-full text-left text-xs" data-meta-age>
        <thead className="text-[11px] text-muted-foreground">
          <tr>
            <th className={TH}>Age</th>
            <th className={THN}>Spend</th>
            <th className={THN}>Impr. share</th>
            <th className={THN}>Link CTR</th>
            <th className={THN}>Signups</th>
            <th className={THN}>£ / signup</th>
            <th className={THN}>Purchases</th>
            <th className={THN}>£ / purchase</th>
            <th className={`${THN} pr-0`}>Revenue</th>
          </tr>
        </thead>
        <tbody>
          {[...rows, total].map((r) => (
            <tr key={r.segment} className={`border-t border-border ${r === total ? "font-medium" : ""}`}>
              <td className={TD}>{r.segment}</td>
              <td className={TDN}>{r.spendText}</td>
              <td className={TDN}>{r === total ? "" : r.impressionShareText}</td>
              <td className={TDN}>{r.linkCtrText}</td>
              <td className={TDN}>{r.signupsText}</td>
              <td className={TDN}>{r.costPerSignupText}</td>
              <td className={TDN}>{r.purchasesText}</td>
              <td className={TDN}>{r.costPerPurchaseText}</td>
              <td className={`${TDN} pr-0`}>{r.revenueText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  );
}

function RegionTable({ rows }: { rows: MetaRegionRow[] }) {
  return (
    <Scroll>
      <table className="w-max min-w-full text-left text-xs sm:min-w-0" data-meta-region>
        <thead className="text-[11px] text-muted-foreground">
          <tr>
            <th className={TH}>Region</th>
            <th className={THN}>Spend</th>
            <th className={THN}>Impr. share</th>
            <th className={`${THN} pr-0`}>Link CTR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.segment} className="border-t border-border">
              <td className={TD}>{r.segment}</td>
              <td className={TDN}>{r.spendText}</td>
              <td className={TDN}>{r.impressionShareText}</td>
              <td className={`${TDN} pr-0`}>{r.linkCtrText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  );
}

function TikTokTable({ rows, total, first, data }: { rows: TikTokRow[]; total: TikTokRow | null; first: string; data: string }) {
  const all = total ? [...rows, total] : rows;
  return (
    <Scroll>
      <table className="w-max min-w-full text-left text-xs sm:min-w-0" data-tiktok={data}>
        <thead className="text-[11px] text-muted-foreground">
          <tr>
            <th className={TH}>{first}</th>
            <th className={THN}>Spend</th>
            <th className={THN}>Impressions</th>
            <th className={THN}>Impr. share</th>
            <th className={THN}>Clicks</th>
            <th className={`${THN} pr-0`}>CTR</th>
          </tr>
        </thead>
        <tbody>
          {all.map((r) => (
            <tr key={r.segment} className={`border-t border-border ${r === total ? "font-medium" : ""}`}>
              <td className={TD}>{r.segment}</td>
              <td className={TDN}>{r.spendText}</td>
              <td className={TDN}>{r.impressionsText}</td>
              <td className={TDN}>{r === total ? "" : r.impressionShareText}</td>
              <td className={TDN}>{r.clicksText}</td>
              <td className={`${TDN} pr-0`}>{r.ctrText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  );
}

const NOTE = "mt-2 max-w-3xl text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]";

export function WhoWeReachedPanel({ model }: { model: WhoWeReachedModel }) {
  const meta = model.metaSays;
  const tiktok = model.tiktok;
  return (
    <section className="mx-auto w-full min-w-0 max-w-6xl px-3 py-4 sm:px-6" data-panel="who-we-reached">
      <h2 className="text-lg font-medium tracking-tight sm:text-xl">{model.title}</h2>

      <div className="mt-4">
        <h3 className="text-sm font-medium">{meta.title}</h3>
        {meta.empty ? (
          <p className={NOTE}>{meta.empty}</p>
        ) : meta.withheld ? (
          <p className={NOTE} data-withheld>
            {meta.withheld}
          </p>
        ) : (
          <>
            <MetaAgeTable rows={meta.byAge} total={meta.total} />
            <p className={NOTE}>{meta.footnote}</p>
            {meta.totalsNote ? (
              <p className="mt-1 max-w-3xl text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]" data-totals-note>
                {meta.totalsNote}
              </p>
            ) : null}
          </>
        )}
      </div>

      {meta.region ? (
        <div className="mt-6">
          <h3 className="text-sm font-medium">{meta.region.title}</h3>
          <RegionTable rows={meta.region.rows} />
          <p className={NOTE}>{meta.region.note}</p>
        </div>
      ) : null}

      <div className="mt-6">
        <h3 className="text-sm font-medium">{tiktok.ageTitle}</h3>
        {tiktok.empty ? (
          <p className={NOTE}>{tiktok.empty}</p>
        ) : (
          <>
            <TikTokTable rows={tiktok.byAge} total={tiktok.total} first="Age" data="age" />
            {tiktok.byNation.length ? (
              <>
                <h3 className="mt-5 text-sm font-medium">{tiktok.nationTitle}</h3>
                <TikTokTable rows={tiktok.byNation} total={null} first="Nation" data="nation" />
              </>
            ) : null}
            <p className={NOTE}>
              {tiktok.footnote} · {tiktok.note}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
