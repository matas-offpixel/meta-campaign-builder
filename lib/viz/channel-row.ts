import type { VizPlatform, VizStatus } from "./tokens.ts";

export type ChannelRowState = "waiting" | "ready" | "blocked" | "paused" | "live";

export type ChannelFact = { n: number; noun: string };

export function formatChannelFacts(facts: ChannelFact[]): string {
  return facts.map((fact) => `${fact.n} ${fact.noun}`).join(" · ");
}

export function channelRowState(input: {
  status: VizStatus;
  waiting?: boolean;
  blocked?: boolean;
}): ChannelRowState {
  if (input.waiting) return "waiting";
  if (input.status === "paused") return "paused";
  if (input.status === "live") return "live";
  if (input.blocked || input.status === "blocked") return "blocked";
  if (input.status === "ready" || input.status === "complete") return "ready";
  return input.status === "idle" ? "waiting" : "ready";
}

export function waitingCopy(forPlatform: VizPlatform = "meta"): string {
  const glyph = forPlatform === "meta" ? "f" : forPlatform === "tiktok" ? "♪" : "G";
  return `waiting for ${glyph}`;
}

export function channelRowView(input: {
  status: VizStatus;
  facts: ChannelFact[];
  derived?: boolean;
  waiting?: boolean;
  blocked?: boolean;
  waitingFor?: VizPlatform;
}): {
  state: ChannelRowState;
  showDerived: boolean;
  showResume: boolean;
  showFactsText: boolean;
  showLiveFacts: boolean;
  factsText: string;
  waitingText: string | null;
} {
  const state = channelRowState(input);
  return {
    state,
    showDerived: Boolean(input.derived) && state !== "waiting",
    showResume: state === "paused",
    showFactsText: state !== "live" && state !== "waiting",
    showLiveFacts: state === "live",
    factsText: formatChannelFacts(input.facts),
    waitingText: state === "waiting" ? waitingCopy(input.waitingFor ?? "meta") : null,
  };
}
