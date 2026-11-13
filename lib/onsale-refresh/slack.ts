/**
 * The ads_automation post when a proposal is ready (R4). One per
 * proposal, deduped on the proposal id, under notify()'s own killswitch,
 * channel switch and business hours. Shadow proposals say so.
 */

import type { NotifyOptions } from "../notify/slack.ts";
import type { Proposal } from "./rules.ts";
import { shortDay, weekLabel, type RunPlan } from "./schedule.ts";

export type SlackProposal = {
  proposalId: string;
  eventName: string;
  eventCode: string | null;
  eventId: string;
  campaignKey: string;
  plan: RunPlan;
  mode: "shadow" | "live";
  proposal: Proposal;
};

const KIND_WORD: Record<string, string> = {
  add_creative: "add",
  claim_ready: "claim",
  pause_creative: "pause",
  bring_back_audience: "bring back",
  missing_default: "default",
  drop_audience: "drop",
  move_budget: "move",
};

export function slackMessage(args: SlackProposal, appUrl: string): NotifyOptions {
  const counts = new Map<string, number>();
  for (const line of args.proposal.lines) counts.set(line.kind, (counts.get(line.kind) ?? 0) + 1);
  const breakdown = [...counts].map(([kind, n]) => `${n} ${KIND_WORD[kind] ?? kind}${n === 1 ? "" : "s"}`).join(" · ");
  const url = `${appUrl.replace(/\/$/, "")}/events/${args.eventId}?tab=overview#onsale-refresh`;
  const kind = args.plan.runKind === "cycle" ? "cycle refresh" : args.plan.runKind === "mid_cycle" ? "mid-cycle check" : "shadow run";
  const head = `On-sale refresh · ${args.eventName}${args.eventCode ? ` [${args.eventCode}]` : ""} · ${weekLabel(args.plan.cycleMonday)} · ${args.mode === "shadow" ? "Shadow — " : ""}${args.proposal.lines.length} to review`;
  const text = [
    head,
    `${kind} · data to ${shortDay(args.plan.window.end)}${args.plan.nextCheck ? ` · next: ${shortDay(args.plan.nextCheck)}` : ""}`,
    args.campaignKey,
    args.proposal.why.objective,
    args.proposal.why.purchase,
    args.proposal.why.attributed ?? "",
    args.proposal.why.context ?? "",
    args.proposal.notEnoughData ?? breakdown,
    args.mode === "shadow" ? "Shadow: nothing here can be applied yet." : "",
    url,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    channel: "ads_automation",
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${head}*\n${kind} · data to ${shortDay(args.plan.window.end)}` } },
      { type: "section", text: { type: "mrkdwn", text: [args.campaignKey, args.proposal.why.objective, args.proposal.why.purchase, args.proposal.why.attributed ?? "", args.proposal.why.context ?? ""].filter(Boolean).join("\n") } },
      { type: "section", text: { type: "mrkdwn", text: args.proposal.notEnoughData ?? breakdown } },
      { type: "section", text: { type: "mrkdwn", text: `<${url}|Open the Refresh panel>${args.mode === "shadow" ? " · Shadow: nothing applies yet." : ""}` } },
    ],
    dedupeKey: `onsale_refresh:${args.proposalId}`,
    dedupeWindowMs: Number.MAX_SAFE_INTEGER,
  };
}

/**
 * E4: the pixel mismatch, once per event until the ads' pixel and the
 * client's stored pixel match. Deduped on the event and the pair, so a
 * later run (or the 10:05 catch-up) repeats nothing and a changed pair
 * says so once.
 */
export function pixelSlackMessage(args: { eventId: string; eventName: string; eventCode: string | null; lines: readonly string[]; pixelId: string; storedPixelId: string | null }): NotifyOptions {
  const head = `On-sale refresh · ${args.eventName}${args.eventCode ? ` [${args.eventCode}]` : ""}`;
  const text = [head, ...args.lines].join("\n");
  return {
    channel: "ads_automation",
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: `*${head}*\n${args.lines.join("\n")}` } }],
    dedupeKey: `onsale_refresh_pixel:${args.eventId}:${args.pixelId}:${args.storedPixelId ?? "none"}`,
    dedupeWindowMs: Number.MAX_SAFE_INTEGER,
  };
}
