/**
 * HE4's words. The figures come from buildPresaleLog; this only names them
 * (E3, PH1, PH2, PH7).
 */

import { enteredByWords, formatDay, META_SIGNUP_SPEND, type Entered, type Figure, type PresaleLog } from "../presale/model.ts";
import { instantText, londonParts } from "./dates.ts";

export interface PresaleRow {
  label: string;
  value: string;
  source: string | null;
}

export interface PresalePanelModel {
  title: "Presale";
  show: string;
  eventId: string;
  /** "Wed 9 Sep" when the open is known. */
  open: string | null;
  /**
   * "Add the window figures" on an internal page with nothing entered.
   * The share link leaves it out.
   */
  prompt: string | null;
  rows: PresaleRow[];
  /** Internal pages draw the entry form. The share link does not. */
  form: boolean;
}

const DASH = "—";

export function pounds(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const sign = rounded < 0 ? "−" : "";
  return `${sign}£${Math.abs(rounded).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function count(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)} %`;
}

function multiple(n: number): string {
  return `${n.toFixed(2)}×`;
}

function enteredSource(entered: Entered, nowMs: number): string {
  const words = enteredByWords(entered);
  const year = londonParts(entered.at)?.year;
  const now = londonParts(nowMs)?.year;
  return year && now && year !== now ? `${words} ${year}` : words;
}

/** The source line a figure prints. Null when the figure is missing. */
export function figureSource(fig: Figure<unknown>, nowMs: number): string | null {
  if (fig.kind !== "value") return null;
  if (fig.source === "entered") return fig.entered ? enteredSource(fig.entered, nowMs) : "entered";
  if (fig.from === "CIRQLIN") return "counted · CIRQLIN";
  if (fig.from === "Internal Counts") return "counted · Internal Counts";
  if (fig.from === META_SIGNUP_SPEND) return META_SIGNUP_SPEND;
  if (fig.from.startsWith("Mailchimp ·")) return fig.source === "est." ? `${fig.from} · est.` : fig.from;
  if (fig.source === "est.") return "est.";
  if (fig.source === "derived") return fig.from === "Derived" ? "derived" : "derived";
  if (fig.source === "counted") return `counted · ${fig.from}`;
  return fig.source;
}

function num(fig: Figure<number>, text: (n: number) => string, nowMs: number): { value: string; source: string | null } {
  if (fig.kind !== "value") return { value: DASH, source: null };
  return { value: text(fig.value), source: figureSource(fig, nowMs) };
}

function row(label: string, fig: Figure<number>, text: (n: number) => string, nowMs: number): PresaleRow {
  const shown = num(fig, text, nowMs);
  return { label, value: shown.value, source: shown.source };
}

export function presalePanel(log: PresaleLog, opts: { show: string; surface: "internal" | "share"; nowMs: number }): PresalePanelModel {
  const now = opts.nowMs;
  const through = log.signupsAtPresale.kind === "value" ? String(log.signupsAtPresale.detail?.throughDay ?? "") : "";
  const signupsLabel = log.signupsAtPresaleLabel
    ? through.length === 10
      ? `${log.signupsAtPresaleLabel}${through.slice(0, 4) !== (londonParts(now)?.year ?? "") ? ` ${through.slice(0, 4)}` : ""}`
      : log.signupsAtPresaleLabel
    : "Signups at presale";
  const window = log.windowStart.kind === "value"
    ? { value: instantText(log.windowStart.value, now), source: figureSource(log.windowStart, now) }
    : { value: DASH, source: null };
  const rows = [
    { label: signupsLabel, ...num(log.signupsAtPresale, count, now) },
    row("Signup spend", log.registrationSpend, pounds, now),
    { label: "Window start", ...window },
    row("Community at presale", log.communityAtPresale, count, now),
    row("Sold in community window", log.soldInWindow, count, now),
    row("Presale-day tickets", log.presaleDayTickets, count, now),
    row("Signup spend per presale ticket", log.signupSpendPerPresaleTicket, pounds, now),
    row("Community conversion", log.communityConversion, pct, now),
    row("Wider conversion", log.widerConversion, pct, now),
    row("Average ticket price", log.averageTicketPrice, pounds, now),
    row("Presale return", log.presaleReturn, multiple, now),
  ].filter((r) => r.value !== DASH);
  return {
    title: "Presale",
    show: opts.show,
    eventId: log.eventId,
    open: log.presaleDay ? `${formatDay(log.presaleDay)}${log.presaleDay.slice(0, 4) !== (londonParts(now)?.year ?? "") ? ` ${log.presaleDay.slice(0, 4)}` : ""}` : null,
    prompt: opts.surface === "internal" ? log.prompt : null,
    form: opts.surface === "internal",
    rows,
  };
}
