import type { TikTokLaunchEntity } from "./types.ts";
import type { TikTokLaunchPhase, TikTokLaunchProgress } from "./progress.ts";

export type TikTokLaunchStreamSuccessBody = {
  ok: true;
  campaign_id: string;
  adgroup_ids: string[];
  ad_ids: string[];
  launched_at: string;
  entities: TikTokLaunchEntity[];
};

export type TikTokLaunchStreamErrorBody = {
  ok: false;
  error: string;
  reason?: string;
  preflight?: Array<{ id: string; field: string; message: string }>;
  tiktok?: { code?: number; message: string; request_id?: string };
};

export type TikTokLaunchStreamProgressEvent = {
  type: "progress";
} & TikTokLaunchProgress;

export type TikTokLaunchStreamResultEvent = {
  type: "result";
  status: number;
  body: TikTokLaunchStreamSuccessBody | TikTokLaunchStreamErrorBody;
};

export type TikTokLaunchStreamEvent =
  | TikTokLaunchStreamProgressEvent
  | TikTokLaunchStreamResultEvent;

export function parseTikTokLaunchStreamLine(
  line: string,
): TikTokLaunchStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.type === "progress") {
    return {
      type: "progress",
      phase: asPhase(record.phase),
      campaignId: typeof record.campaignId === "string" ? record.campaignId : null,
      adGroupsDone: asCount(record.adGroupsDone),
      adGroupsTotal: asCount(record.adGroupsTotal),
      adsDone: asCount(record.adsDone),
      adsTotal: asCount(record.adsTotal),
    };
  }
  if (record.type === "result") {
    return {
      type: "result",
      status: typeof record.status === "number" ? record.status : 500,
      body: (record.body ?? {
        ok: false,
        error: "TikTok launch failed",
      }) as TikTokLaunchStreamSuccessBody | TikTokLaunchStreamErrorBody,
    };
  }
  return null;
}

export async function readTikTokLaunchStream(
  res: Response,
  onEvent: (event: TikTokLaunchStreamEvent) => void,
): Promise<void> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("ndjson") || !res.body) {
    const json = (await res.json().catch(() => null)) as
      | TikTokLaunchStreamSuccessBody
      | TikTokLaunchStreamErrorBody
      | null;
    onEvent({
      type: "result",
      status: res.status,
      body: json ?? { ok: false, error: "TikTok launch failed" },
    });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseTikTokLaunchStreamLine(line);
      if (event) onEvent(event);
    }
  }
  const last = parseTikTokLaunchStreamLine(buffer);
  if (last) onEvent(last);
}

function asPhase(value: unknown): TikTokLaunchPhase {
  if (value === "campaign" || value === "adgroup" || value === "ad") {
    return value;
  }
  return "campaign";
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
