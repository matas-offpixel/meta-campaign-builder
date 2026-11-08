import { PUZZLE_SAMPLES, PUZZLE_VENUES } from "@/lib/creative-lab/voice-fixtures";
import { extractTraits, traitRows, type TraitRow } from "@/lib/creative-lab/voice-traits";

const CSS = `
.vroot{background:#F0C9A8;color:#1e1810;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.vroot *{box-sizing:border-box}
.wide{display:block}
.wide.row{display:flex}
.narrow{display:none}
@media (max-width:700px){.wide{display:none !important}.narrow{display:block !important}}
.sec{background:#e8d4c0;border:1px solid rgba(30,24,16,.10);border-radius:10px;padding:14px}
.sec-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 10px}
.sec h3{font-size:14px;font-weight:600;margin:0}
.muted{color:#7A6A5C}
.k{font:700 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#7A6A5C}
.btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:6px;border:1px solid rgba(30,24,16,.18);background:transparent;color:#1e1810;font:600 12px system-ui,sans-serif;white-space:nowrap}
.btn.solid{background:#1e1810;color:#F0C9A8;border-color:#1e1810}
.btn.sm{height:24px;padding:0 9px;font-size:11.5px}
.ctl{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}
.fld{display:flex;flex-direction:column;gap:4px}
.seg{display:inline-flex;border:1px solid rgba(30,24,16,.18);border-radius:6px;overflow:hidden;height:28px}
.seg span{padding:0 11px;display:inline-flex;align-items:center;font:600 12px system-ui,sans-serif;color:#4a3d30;border-right:1px solid rgba(30,24,16,.18)}
.seg span:last-child{border-right:0}
.seg span.on{background:#1e1810;color:#F0C9A8}
.sel{height:28px;padding:0 10px;border:1px solid rgba(30,24,16,.18);border-radius:6px;display:inline-flex;align-items:center;gap:8px;font:12px system-ui,sans-serif;background:#f6ebe0;min-width:120px}
.sel i{font-style:normal;color:#7A6A5C;margin-left:auto}
.chip{display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:99px;font:600 8.5px/1 ui-monospace,Menlo,monospace;border:1px solid rgba(30,24,16,.18);color:#4a3d30}
.chip.ok{color:#5F6B2A;border-color:#5F6B2A}
.vrow{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}
.vchip{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 10px 0 8px;border-radius:99px;border:1px solid rgba(30,24,16,.18);background:#f6ebe0;font:600 12px system-ui,sans-serif;color:#1e1810;white-space:nowrap}
.vchip .dot{width:7px;height:7px;border-radius:50%;background:#B0607A;display:inline-block}
.vchip .n{font:600 10.5px ui-monospace,Menlo,monospace;color:#7A6A5C}
.vchip .go{color:#7A6A5C;font-size:13px;margin-left:2px}
.vchip.house{border-style:dashed;color:#4a3d30}
.vchip.house .dot{background:#7A6A5C}
.vchip.house.cant .dot{background:#A86B12}
.vwhy{font-size:11.5px;color:#7A6A5C}
.vwhy b{color:#4a3d30;font-weight:600}
.vsheet{width:440px;background:#f6ebe0;border-left:1px solid rgba(30,24,16,.18);box-shadow:-8px 0 24px rgba(30,24,16,.14);display:flex;flex-direction:column;font-size:12.5px}
.vh{padding:14px 16px 10px;border-bottom:1px solid rgba(30,24,16,.10)}
.vh .top{display:flex;justify-content:space-between;align-items:center}
.vh .top b{font-size:14px}
.vh .sub{font:10.5px ui-monospace,Menlo,monospace;color:#7A6A5C;margin-top:4px}
.vb{padding:6px 16px 16px}
.vsec{padding:10px 0 12px;border-bottom:1px solid rgba(30,24,16,.10)}
.vsec .h{display:flex;justify-content:space-between;align-items:baseline;margin:0 0 6px}
.tr{display:grid;grid-template-columns:92px 1fr 64px;gap:2px 10px;align-items:center;padding:4px 0;font-size:12px}
.tr .l{font-weight:600;color:#4a3d30;font-size:11.5px}
.tr .v{color:#1e1810}
.tr .v small{color:#7A6A5C;font-size:11px}
.tr .ev{font:10.5px ui-monospace,Menlo,monospace;color:#7A6A5C;text-align:right;white-space:nowrap}
.tr.off .v,.tr.off .l{color:#7A6A5C}
.tr.off s{color:#A86B12;text-decoration:none;font-size:11px}
.ex{border:1px solid rgba(30,24,16,.10);border-radius:8px;padding:8px 10px;margin:6px 0;background:rgba(255,255,255,.18);font-size:12px;line-height:1.4;white-space:pre-line}
.ex .m{display:flex;gap:8px;align-items:center;font:10.5px ui-monospace,Menlo,monospace;color:#7A6A5C;margin-top:6px;white-space:normal}
.ex .m .lk{margin-left:auto}
.ex .pl{width:18px;height:18px;border:1px solid rgba(30,24,16,.18);border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px}
.foot{font-size:11.5px;color:#7A6A5C;margin-top:8px}
.empty{font-size:12px;color:#4a3d30;background:rgba(30,24,16,.06);border-radius:6px;padding:10px 12px}
.cantbox{font-size:12px;color:#4a3d30;background:rgba(30,24,16,.06);border-radius:6px;padding:10px 12px;border-left:3px solid #A86B12}
.phone{position:relative;min-height:852px;background:#F0C9A8}
.scrim{position:absolute;inset:0;background:rgba(30,24,16,.35)}
.bsheet{position:absolute;left:0;right:0;bottom:0;height:88%;background:#f6ebe0;border-radius:14px 14px 0 0;box-shadow:0 -8px 24px rgba(30,24,16,.18);display:flex;flex-direction:column;font-size:12.5px}
.grab{width:38px;height:4px;border-radius:2px;background:rgba(30,24,16,.18);margin:8px auto 2px}
`;

const LABELS = ["Thu 6 Nov", "Sat 1 Nov", "Thu 30 Oct", "Fri 24 Oct"];
const NOTES: Record<string, string> = {
  Length: " · overlay keeps its own limits",
  Emoji: " · primary text only",
  "Sign-off": " · may close the primary text",
};

function Rows({ rows, narrow }: { rows: TraitRow[]; narrow?: boolean }) {
  return (
    <>
      {rows.map((row) => (
        <div key={row.label} className={row.off ? "tr off" : "tr"} style={narrow ? { gridTemplateColumns: "78px 1fr 56px" } : undefined}>
          <span className="l">{row.label}</span>
          <span className="v">
            {row.value}
            {!narrow && NOTES[row.label] ? <small>{NOTES[row.label]}</small> : null}
            {row.off ? <s>{narrow ? " · not written" : " · read, not written"}</s> : null}
          </span>
          <span className="ev">{row.evidence}</span>
        </div>
      ))}
    </>
  );
}

function Exemplar({ index }: { index: number }) {
  const sample = PUZZLE_SAMPLES[index];
  if (!sample) return null;
  return (
    <div className="ex">
      {sample.caption}
      <div className="m"><span>{LABELS[index]}</span><span className="lk">♥ {sample.likes}</span><span className="pl">↗</span></div>
    </div>
  );
}

function Generator({ artist, puzzle }: { artist?: boolean; puzzle?: boolean }) {
  return (
    <div className="sec" style={puzzle ? { opacity: 0.55 } : undefined}>
      <div className="sec-h"><h3>Captions</h3><span className="muted" style={{ fontSize: 12 }}>Stage: on sale · CTA Get tickets</span></div>
      <div className="ctl">
        <div className="fld"><span className="k">Mode</span><span className="seg"><span className="on">Caption</span><span>Quote</span></span></div>
        <div className="fld"><span className="k">Angle</span><span className="seg"><span className={artist ? "" : "on"}>Lineup</span><span className={artist ? "on" : ""}>Artist, first person</span><span>POV</span><span>Scarcity</span></span></div>
        {artist ? <div className="fld"><span className="k">Artist</span><span className="sel">Enzo Siragusa <span className="chip ok">✓ artist channels</span><i>▾</i></span></div> : null}
        {!artist && !puzzle ? <div className="fld"><span className="k">Stage</span><span className="sel">On sale<i>▾</i></span></div> : null}
        <div className="fld"><span className="k">How many</span><span className="seg"><span>1</span><span className="on">3</span><span>5</span></span></div>
        {!artist && !puzzle ? <div className="fld"><span className="k">Pair with</span><span className="seg"><span className="on">Best clip</span><span>Each new clip</span></span></div> : null}
        <div className="fld" style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 8 }}><span className="btn sm">More ▾</span><span className="btn solid">Write 3</span></div>
      </div>
      {puzzle ? (
        <div className="vrow"><span className="vchip" style={{ borderColor: "#1e1810" }}><span className="dot" />Sounds like @puzzle <span className="n">· 24 posts</span><span className="go">‹</span></span></div>
      ) : artist ? (
        <div className="vrow"><span className="vchip"><span className="dot" />Sounds like @enzosiragusa <span className="n">· 30 posts</span><span className="go">›</span></span><span className="vwhy"><b>Artist voice</b> · his own posts, not the promoter&apos;s · read Thu 6 Nov with Find clips</span></div>
      ) : (
        <div className="vrow"><span className="vchip"><span className="dot" />Sounds like @puzzle <span className="n">· 24 posts</span><span className="go">›</span></span><span className="vwhy"><b>Promoter voice</b> · every angle but Artist, first person · read today 09:12 · shape from Lineup · facts from the event</span></div>
      )}
    </div>
  );
}

export function VoiceFrameMount({ id }: { id: string }) {
  const traits = extractTraits(PUZZLE_SAMPLES, PUZZLE_VENUES);
  const wide = traitRows(traits, "wide");
  const narrow = traitRows(traits, "narrow");
  return (
    <div data-frame-ready={id} className="vroot">
      <style>{CSS}</style>
      {id === "CLV1" ? (
        <>
          <div className="wide" style={{ padding: 18 }}>
            <Generator />
            <div style={{ height: 14 }} />
            <Generator artist />
          </div>
          <div className="narrow" style={{ padding: 12 }}>
            <div className="sec" style={{ padding: 12 }}>
              <div className="sec-h"><h3>Captions</h3><span className="muted" style={{ fontSize: 11 }}>on sale</span></div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <div className="fld"><span className="k">Mode</span><span className="seg"><span className="on">Caption</span><span>Quote</span></span></div>
                <div className="fld" style={{ flex: 1 }}><span className="k">Angle</span><span className="sel" style={{ minWidth: 0 }}>Lineup<i>▾</i></span></div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}><span className="btn solid" style={{ flex: 1, justifyContent: "center" }}>Write 3</span><span className="btn sm">More ▾</span></div>
              <div className="vrow"><span className="vchip" style={{ width: "100%" }}><span className="dot" />Sounds like @puzzle <span className="n" style={{ marginLeft: "auto" }}>24 posts</span><span className="go">›</span></span></div>
              <div className="vwhy" style={{ marginTop: 6 }}><b>Promoter voice</b> · read today 09:12</div>
            </div>
          </div>
        </>
      ) : null}
      {id === "CLV2" ? (
        <>
          <div className="wide row" style={{ minHeight: 920 }}>
            <div style={{ flex: 1, padding: 18, minWidth: 0 }}><Generator puzzle /></div>
            <div className="vsheet">
              <div className="vh"><div className="top"><b>Sounds like @puzzle</b><span className="muted">✕</span></div><div className="sub">24 POSTS READ · TODAY 09:12 · AGAIN ON FIND CLIPS AND NIGHTLY</div></div>
              <div className="vb">
                <div className="vsec"><div className="h"><span className="k">Traits the writer took</span><span className="k">of 24</span></div><Rows rows={wide} /></div>
                <div className="vsec">
                  <div className="h"><span className="k">Exemplars · newest first</span><span className="k">verbatim</span></div>
                  {[0, 1, 2, 3].map((index) => <Exemplar key={index} index={index} />)}
                  <div className="foot">+ 20 more · Exemplars set the tone. No line is reused.</div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", margin: "6px 0 10px" }}><span className="btn sm">Read again</span></div>
              </div>
            </div>
          </div>
          <div className="narrow phone">
            <div style={{ padding: 12 }}><b>Captions</b><div className="muted" style={{ fontSize: 12 }}>on sale</div></div>
            <div className="scrim" />
            <div className="bsheet">
              <div className="grab" />
              <div className="vh"><div className="top"><b>Sounds like @puzzle</b><span className="muted">✕</span></div><div className="sub">24 POSTS · TODAY 09:12 · FIND CLIPS AND NIGHTLY</div></div>
              <div className="vb">
                <div className="vsec"><div className="h"><span className="k">Traits the writer took</span><span className="k">of 24</span></div><Rows rows={narrow} narrow /></div>
                <div className="vsec">
                  <div className="h"><span className="k">Exemplars</span><span className="k">verbatim</span></div>
                  <Exemplar index={0} />
                  <Exemplar index={1} />
                  <div className="foot">+ 22 more · No line is reused.</div>
                </div>
                <span className="btn sm" style={{ width: "100%", justifyContent: "center", margin: "6px 0 12px" }}>Read again</span>
              </div>
            </div>
          </div>
        </>
      ) : null}
      {id === "CLV3" ? (
        <>
          <div className="wide row" style={{ minHeight: 300 }}>
            <div style={{ flex: 1, padding: 18 }}>
              <div className="sec">
                <div className="sec-h"><h3>Captions</h3><span className="muted" style={{ fontSize: 12 }}>Stage: on sale · CTA Get tickets</span></div>
                <div className="ctl">
                  <div className="fld"><span className="k">Mode</span><span className="seg"><span className="on">Caption</span><span>Quote</span></span></div>
                  <div className="fld"><span className="k">Angle</span><span className="seg"><span className="on">Lineup</span><span>Artist, first person</span><span>POV</span><span>Scarcity</span></span></div>
                  <div className="fld" style={{ marginLeft: "auto", flexDirection: "row", gap: 8 }}><span className="btn sm">More ▾</span><span className="btn solid">Write 3</span></div>
                </div>
                <div className="vrow"><span className="vchip house"><span className="dot" />House voice <span className="n">· no posts read yet</span><span className="go">›</span></span><span className="vwhy">No posts read yet — Find clips reads them.</span></div>
              </div>
            </div>
            <div className="vsheet">
              <div className="vh"><div className="top"><b>House voice</b><span className="muted">✕</span></div><div className="sub">@puzzle · NOT READ YET</div></div>
              <div className="vb">
                <div className="empty">No posts read yet — Find clips reads them. Until then the writer uses the house voice: the style&apos;s seed examples and the event&apos;s facts.</div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}><span className="btn sm solid">Find clips</span><span className="muted" style={{ fontSize: 11.5 }}>reads the page&apos;s reels and its last 30 captions in one call</span></div>
              </div>
            </div>
          </div>
          <div className="narrow" style={{ padding: 12 }}>
            <div className="sec" style={{ padding: 12 }}>
              <div className="sec-h"><h3>Captions</h3><span className="muted" style={{ fontSize: 11 }}>on sale</span></div>
              <div style={{ display: "flex", gap: 10 }}>
                <div className="fld"><span className="k">Mode</span><span className="seg"><span className="on">Caption</span><span>Quote</span></span></div>
                <div className="fld" style={{ flex: 1 }}><span className="k">Angle</span><span className="sel" style={{ minWidth: 0 }}>Lineup<i>▾</i></span></div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}><span className="btn solid" style={{ flex: 1, justifyContent: "center" }}>Write 3</span><span className="btn sm">More ▾</span></div>
              <div className="vrow"><span className="vchip house" style={{ width: "100%" }}><span className="dot" />House voice<span className="n" style={{ marginLeft: "auto" }}>not read</span><span className="go">›</span></span></div>
              <div className="vwhy" style={{ marginTop: 6 }}>No posts read yet — Find clips reads them.</div>
            </div>
          </div>
        </>
      ) : null}
      {id === "CLV4" ? (
        <>
          <div className="wide" style={{ padding: 18 }}>
            <div className="sec">
              <div className="sec-h"><h3>Captions</h3><span className="muted" style={{ fontSize: 12 }}>Stage: on sale · CTA Get tickets</span></div>
              <div className="ctl">
                <div className="fld"><span className="k">Mode</span><span className="seg"><span className="on">Caption</span><span>Quote</span></span></div>
                <div className="fld"><span className="k">Angle</span><span className="seg"><span>Lineup</span><span className="on">Artist, first person</span><span>POV</span><span>Scarcity</span></span></div>
                <div className="fld"><span className="k">Artist</span><span className="sel">Luke Dean <span className="chip">Promoter page only</span><i>▾</i></span></div>
                <div className="fld"><span className="k">How many</span><span className="seg"><span>1</span><span className="on">3</span><span>5</span></span></div>
                <div className="fld" style={{ marginLeft: "auto", flexDirection: "row", gap: 8 }}><span className="btn sm">More ▾</span><span className="btn solid">Write 3</span></div>
              </div>
              <div className="vrow"><span className="vchip house cant"><span className="dot" />House voice <span className="n">· @lukedean can&apos;t be read</span><span className="go">›</span></span><span className="vwhy">@lukedean can&apos;t be read: not a business or creator account. Artist-voice captions use the house voice until it is. <b>His captions will also be Held</b> — he is Promoter page only.</span></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginTop: 14 }}>
              <div className="sec"><div className="k" style={{ marginBottom: 8 }}>Empty feed</div><span className="vchip house"><span className="dot" />House voice <span className="n">· @reeshy has 2 posts</span><span className="go">›</span></span><div className="vwhy" style={{ marginTop: 8 }}>@reeshy has 2 posts, fewer than 8. The writer uses the house voice until there are more.</div></div>
              <div className="sec"><div className="k" style={{ marginBottom: 8 }}>No handle</div><span className="vchip house"><span className="dot" />House voice <span className="n">· no Instagram on the row</span><span className="go">›</span></span><div className="vwhy" style={{ marginTop: 8 }}>Add Instagram on Benji King&apos;s row — the same action the row already has.</div></div>
              <div className="sec"><div className="k" style={{ marginBottom: 8 }}>Read, but stale</div><span className="vchip"><span className="dot" />Sounds like @philldejaneiro <span className="n">· 30 posts</span><span className="go">›</span></span><div className="vwhy" style={{ marginTop: 8 }}>Read Fri 10 Oct · the nightly pass has not reached it since. The corpus still counts; the sheet says when it was read.</div></div>
            </div>
          </div>
          <div className="narrow" style={{ padding: 12 }}>
            <div className="sec" style={{ padding: 12 }}>
              <div className="sec-h"><h3>Captions</h3><span className="muted" style={{ fontSize: 11 }}>on sale</span></div>
              <div style={{ display: "flex", gap: 10 }}>
                <div className="fld"><span className="k">Mode</span><span className="seg"><span className="on">Caption</span><span>Quote</span></span></div>
                <div className="fld" style={{ flex: 1 }}><span className="k">Angle</span><span className="sel" style={{ minWidth: 0 }}>Artist, first person<i>▾</i></span></div>
              </div>
              <div className="fld" style={{ marginTop: 10 }}><span className="k">Artist</span><span className="sel" style={{ minWidth: 0 }}>Luke Dean<i>▾</i></span></div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}><span className="btn solid" style={{ flex: 1, justifyContent: "center" }}>Write 3</span><span className="btn sm">More ▾</span></div>
              <div className="vrow"><span className="vchip house cant" style={{ width: "100%" }}><span className="dot" />House voice<span className="n" style={{ marginLeft: "auto" }}>can&apos;t be read</span><span className="go">›</span></span></div>
              <div className="cantbox" style={{ marginTop: 8 }}>@lukedean can&apos;t be read: not a business or creator account. Artist-voice captions use the house voice until it is.</div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
