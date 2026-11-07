/**
 * One Lambda still of eight frames, then one claude-sonnet-4-6 call with
 * the still and the thumbnail. The still's estimatedPrice is the Lambda
 * cost. A missing key or a failed still is check by eye, not a guess.
 */

import { OVERLAY_PROMPT, OVERLAY_TOOL, type OverlayFrame } from "./overlay-check.ts";
import { renderFrameSheetStill } from "./lambda.ts";

export const OVERLAY_MODEL = "claude-sonnet-4-6";

export async function judgeOverlay(input: {
  src: string | null;
  times: number[];
  thumbnail: Uint8Array | null;
  sheet?: (src: string, times: number[]) => Promise<{ bytes: Uint8Array; estimatedCostUsd: number | null }>;
  ask?: (images: Uint8Array[]) => Promise<{ verdict?: string; frames?: OverlayFrame[]; reason?: string; unsure?: boolean }>;
}): Promise<{ verdict?: string; frames?: OverlayFrame[]; reason?: string; unsure?: boolean; lambdaCostUsd: number | null }> {
  if (!input.src) return { unsure: true, reason: "Check this one by eye.", lambdaCostUsd: null };
  try {
    const sheet = input.sheet
      ? await input.sheet(input.src, input.times)
      : await defaultSheet(input.src, input.times);
    const images = input.thumbnail ? [sheet.bytes, input.thumbnail] : [sheet.bytes];
    const asked = input.ask ? await input.ask(images) : await askSonnet(images, input.times);
    return { ...asked, lambdaCostUsd: sheet.estimatedCostUsd };
  } catch {
    return { unsure: true, reason: "Check this one by eye.", lambdaCostUsd: null };
  }
}

async function defaultSheet(src: string, times: number[]): Promise<{ bytes: Uint8Array; estimatedCostUsd: number | null }> {
  const still = await renderFrameSheetStill({ src, times });
  const res = await fetch(still.url);
  if (!res.ok) throw new Error("The frame sheet did not download.");
  return { bytes: new Uint8Array(await res.arrayBuffer()), estimatedCostUsd: still.estimatedCostUsd };
}

async function askSonnet(images: Uint8Array[], times: number[]): Promise<{ verdict?: string; frames?: OverlayFrame[]; reason?: string; unsure?: boolean }> {
  if (!process.env.ANTHROPIC_API_KEY) return { unsure: true, reason: "Check this one by eye." };
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
  if (!tool || tool.type !== "tool_use") return { unsure: true, reason: "Check this one by eye." };
  return tool.input as { verdict?: string; frames?: OverlayFrame[]; reason?: string; unsure?: boolean };
}
