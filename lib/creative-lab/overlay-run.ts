/**
 * One Lambda still of eight frames, then one claude-sonnet-4-6 call with
 * the still and the thumbnail. The still's estimatedPrice is the Lambda
 * cost. A missing key or a failed still is check by eye, not a guess.
 *
 * Every check by eye that comes from a failure (no source, the still,
 * the download, the model call) writes one log line with the stage and
 * the error class. No URL or key goes into the line. Until 9 Nov 2026
 * the catch was silent, and every check on prod was check by eye because
 * the deployed Lambda site had no FrameSheet composition.
 */

import { OVERLAY_PROMPT, OVERLAY_TOOL, type OverlayFrame } from "./overlay-check.ts";
import { renderFrameSheetStill } from "./lambda.ts";

export const OVERLAY_MODEL = "claude-sonnet-4-6";

export type OverlayStage = "source" | "sheet" | "download" | "model";

/** A failure inside judgeOverlay, tagged with the step it came from. */
class OverlayStepError extends Error {
  readonly stage: OverlayStage;
  readonly inner: unknown;
  constructor(stage: OverlayStage, inner: unknown) {
    super(inner instanceof Error ? inner.message : String(inner));
    this.stage = stage;
    this.inner = inner;
  }
}

const URL_PATTERN = /\b(?:https?|s3):\/\/\S+/gi;
const KEY_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\S*)/g;
const LONG_TOKEN = /\b[A-Za-z0-9+/_=-]{40,}\b/g;

/**
 * The first line of the message, without URLs, keys or long tokens, and
 * cut at the first sentence. A named error (an SDK class) keeps its name.
 */
export function overlayErrorClass(error: unknown): string {
  if (error == null) return "unknown";
  const name = error instanceof Error ? error.name : "";
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const firstLine = raw.split("\n")[0] ?? "";
  const scrubbed = firstLine
    .replace(URL_PATTERN, "<url>")
    .replace(KEY_PATTERN, "<key>")
    .replace(LONG_TOKEN, "<token>")
    .replace(/^(?:Error:\s*)+/, "")
    .trim();
  const sentence = scrubbed.split(/\.\s/)[0]!.replace(/\.$/, "").slice(0, 160);
  const label = name && name !== "Error" ? name : "";
  if (!sentence) return label || "unknown";
  return label ? `${label}: ${sentence}` : sentence;
}

/** One JSON line per failed check, the way generate-log.ts writes one per Generate. */
export function overlayLogLine(args: { stage: OverlayStage; error: unknown }): string {
  return JSON.stringify({ check: "overlay", verdict: "check_by_eye", stage: args.stage, errorClass: overlayErrorClass(args.error) });
}

const BY_EYE = "Check this one by eye.";

async function step<T>(stage: OverlayStage, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw error instanceof OverlayStepError ? error : new OverlayStepError(stage, error);
  }
}

export async function judgeOverlay(input: {
  src: string | null;
  times: number[];
  thumbnail: Uint8Array | null;
  sheet?: (src: string, times: number[]) => Promise<{ bytes: Uint8Array; estimatedCostUsd: number | null }>;
  ask?: (images: Uint8Array[]) => Promise<{ verdict?: string; frames?: OverlayFrame[]; reason?: string; unsure?: boolean }>;
  /** Where the failure line goes. console.warn when unset. */
  log?: (line: string) => void;
}): Promise<{ verdict?: string; frames?: OverlayFrame[]; reason?: string; unsure?: boolean; lambdaCostUsd: number | null }> {
  const log = input.log ?? ((line: string) => console.warn(line));
  if (!input.src) {
    log(overlayLogLine({ stage: "source", error: new Error("no signed source URL") }));
    return { unsure: true, reason: BY_EYE, lambdaCostUsd: null };
  }
  const src = input.src;
  // A still that rendered was paid for, even when the model call after it fails.
  let lambdaCostUsd: number | null = null;
  try {
    const sheet = input.sheet
      ? await step("sheet", () => input.sheet!(src, input.times))
      : await defaultSheet(src, input.times);
    lambdaCostUsd = sheet.estimatedCostUsd;
    const images = input.thumbnail ? [sheet.bytes, input.thumbnail] : [sheet.bytes];
    const asked = await step("model", () => (input.ask ? input.ask(images) : askSonnet(images, input.times)));
    return { ...asked, lambdaCostUsd };
  } catch (error) {
    const stage = error instanceof OverlayStepError ? error.stage : "sheet";
    const inner = error instanceof OverlayStepError ? error.inner : error;
    log(overlayLogLine({ stage, error: inner }));
    return { unsure: true, reason: BY_EYE, lambdaCostUsd };
  }
}

async function defaultSheet(src: string, times: number[]): Promise<{ bytes: Uint8Array; estimatedCostUsd: number | null }> {
  const still = await step("sheet", () => renderFrameSheetStill({ src, times }));
  const res = await step("download", () => fetch(still.url));
  if (!res.ok) throw new OverlayStepError("download", new Error(`frame sheet download returned ${res.status}`));
  return { bytes: new Uint8Array(await res.arrayBuffer()), estimatedCostUsd: still.estimatedCostUsd };
}

async function askSonnet(images: Uint8Array[], times: number[]): Promise<{ verdict?: string; frames?: OverlayFrame[]; reason?: string; unsure?: boolean }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const content: unknown[] = [
    { type: "text", text: `${OVERLAY_PROMPT} Frame times, left to right: ${times.join(", ")}.` },
    ...images.map((bytes) => ({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(bytes).toString("base64") },
    })),
  ];
  const message = await client.messages.create({
    model: OVERLAY_MODEL,
    max_tokens: 800,
    tools: [OVERLAY_TOOL],
    tool_choice: { type: "tool", name: OVERLAY_TOOL.name },
    messages: [{ role: "user", content: content as never }],
  });
  const tool = message.content.find((block) => block.type === "tool_use");
  if (!tool || tool.type !== "tool_use") throw new Error(`no ${OVERLAY_TOOL.name} tool call (stop_reason ${message.stop_reason})`);
  return tool.input as { verdict?: string; frames?: OverlayFrame[]; reason?: string; unsure?: boolean };
}
