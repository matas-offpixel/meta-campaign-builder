import type { TikTokLaunchProgress } from "../tiktok/write/progress.ts";

export type TikTokLaunchPanelState = "in-flight" | "succeeded" | "failed";

export type TikTokLaunchPhaseStatus = "waiting" | "active" | "done";

export interface TikTokLaunchProgressView {
  phase: TikTokLaunchProgress["phase"] | null;
  campaignId: string | null;
  adGroupsDone: number | null;
  adGroupsTotal: number | null;
  adsDone: number | null;
  adsTotal: number | null;
}

export interface TikTokLaunchPanelPhase {
  id: "campaign" | "adgroup" | "ad";
  label: string;
  detail: string;
  status: TikTokLaunchPhaseStatus;
}

export interface TikTokLaunchPanelModel {
  state: TikTokLaunchPanelState;
  title: string;
  description: string;
  boxClass: string;
  phases: TikTokLaunchPanelPhase[];
  campaignId: string | null;
  adGroupCount: number | null;
  adCount: number | null;
  launchedAt: string | null;
  adsManagerUrl: string | null;
  adsManagerLabel: string;
  errorMessage: string | null;
  tiktokMessage: string | null;
  requestId: string | null;
}

export function emptyTikTokLaunchProgress(): TikTokLaunchProgressView {
  return {
    phase: null,
    campaignId: null,
    adGroupsDone: null,
    adGroupsTotal: null,
    adsDone: null,
    adsTotal: null,
  };
}

/** Copy only what the launcher reported. Never invent counts. */
export function applyTikTokLaunchProgress(
  reported: TikTokLaunchProgress,
): TikTokLaunchProgressView {
  return {
    phase: reported.phase,
    campaignId: reported.campaignId,
    adGroupsDone: reported.adGroupsDone,
    adGroupsTotal: reported.adGroupsTotal,
    adsDone: reported.adsDone,
    adsTotal: reported.adsTotal,
  };
}

export function buildTikTokLaunchPanelModel(input: {
  status: "launching" | "success" | "error";
  progress?: TikTokLaunchProgressView;
  campaignId?: string | null;
  adGroupCount?: number | null;
  adCount?: number | null;
  launchedAt?: string | null;
  adsManagerUrl?: string | null;
  errorMessage?: string | null;
  tiktok?: { code?: number; message: string; request_id?: string } | null;
}): TikTokLaunchPanelModel {
  if (input.status === "launching") {
    const progress = input.progress ?? emptyTikTokLaunchProgress();
    return {
      state: "in-flight",
      title: "Launching…",
      description:
        "Creating the campaign, then ad groups, then ads. Ads is the long step.",
      boxClass: "border-primary/40 bg-primary/5",
      phases: buildInFlightPhases(progress),
      campaignId: progress.campaignId,
      adGroupCount: progress.adGroupsDone,
      adCount: progress.adsDone,
      launchedAt: null,
      adsManagerUrl: null,
      adsManagerLabel: "Open in TikTok Ads Manager",
      errorMessage: null,
      tiktokMessage: null,
      requestId: null,
    };
  }

  if (input.status === "success") {
    return {
      state: "succeeded",
      title: "Launched",
      description: "Campaign created paused on TikTok. Open Ads Manager to inspect it.",
      boxClass: "border-emerald-500/40 bg-emerald-500/10",
      phases: [],
      campaignId: input.campaignId ?? null,
      adGroupCount: input.adGroupCount ?? 0,
      adCount: input.adCount ?? 0,
      launchedAt: input.launchedAt ?? null,
      adsManagerUrl: input.adsManagerUrl ?? null,
      adsManagerLabel: "Open in TikTok Ads Manager",
      errorMessage: null,
      tiktokMessage: null,
      requestId: null,
    };
  }

  return {
    state: "failed",
    title: "Launch failed",
    description: "TikTok rejected the write. The request id is what support needs.",
    boxClass: "border-red-500/40 bg-red-500/10",
    phases: [],
    campaignId: null,
    adGroupCount: null,
    adCount: null,
    launchedAt: null,
    adsManagerUrl: null,
    adsManagerLabel: "Open in TikTok Ads Manager",
    errorMessage: input.errorMessage ?? "TikTok launch failed",
    tiktokMessage: input.tiktok?.message ?? null,
    requestId: input.tiktok?.request_id ?? null,
  };
}

export function formatTikTokLaunchPanel(model: TikTokLaunchPanelModel): string {
  const lines = [
    `state:${model.state}`,
    `title:${model.title}`,
    `box:${model.boxClass}`,
  ];
  if (model.campaignId) lines.push(`campaign:${model.campaignId}`);
  if (model.adGroupCount != null) lines.push(`ad_groups:${model.adGroupCount}`);
  if (model.adCount != null) lines.push(`ads:${model.adCount}`);
  if (model.adsManagerUrl) lines.push(`ads_manager:${model.adsManagerUrl}`);
  if (model.errorMessage) lines.push(`error:${model.errorMessage}`);
  if (model.tiktokMessage) lines.push(`tiktok:${model.tiktokMessage}`);
  if (model.requestId) lines.push(`request_id:${model.requestId}`);
  for (const phase of model.phases) {
    lines.push(`phase:${phase.id}:${phase.status}:${phase.detail}`);
  }
  return lines.join("\n");
}

function buildInFlightPhases(
  progress: TikTokLaunchProgressView,
): TikTokLaunchPanelPhase[] {
  return [
    {
      id: "campaign",
      label: "Campaign",
      detail: progress.campaignId
        ? `Created ${progress.campaignId}`
        : "Waiting",
      status: campaignPhaseStatus(progress),
    },
    {
      id: "adgroup",
      label: "Ad groups",
      detail:
        progress.adGroupsTotal == null
          ? "Waiting"
          : `${progress.adGroupsDone ?? 0}/${progress.adGroupsTotal}`,
      status: countedPhaseStatus(
        progress.adGroupsDone,
        progress.adGroupsTotal,
        progress.campaignId != null,
      ),
    },
    {
      id: "ad",
      label: "Ads",
      detail:
        progress.adsTotal == null
          ? "Waiting · this is the long step"
          : `${progress.adsDone ?? 0}/${progress.adsTotal} · this is the long step`,
      status: countedPhaseStatus(
        progress.adsDone,
        progress.adsTotal,
        progress.adGroupsDone != null && progress.adGroupsDone > 0,
      ),
    },
  ];
}

function campaignPhaseStatus(
  progress: TikTokLaunchProgressView,
): TikTokLaunchPhaseStatus {
  if (progress.campaignId) return "done";
  return "waiting";
}

function countedPhaseStatus(
  done: number | null,
  total: number | null,
  started: boolean,
): TikTokLaunchPhaseStatus {
  if (total == null) return "waiting";
  if (done != null && done >= total && total > 0) return "done";
  if (started || (done != null && done > 0)) return "active";
  return "waiting";
}
