import {
  TikTokApiError,
  classifyTikTokRetry,
  tiktokPost,
  type BodyValue,
} from "../client.ts";
import type { TikTokPost, Sleep } from "./idempotency.ts";

export const DEFAULT_WRITE_SLEEP: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function postTikTokWrite<T>(input: {
  path: string;
  body: Record<string, BodyValue>;
  token: string;
  request?: TikTokPost;
  sleep?: Sleep;
}): Promise<T> {
  const request = input.request ?? tiktokPost;
  const sleep = input.sleep ?? DEFAULT_WRITE_SLEEP;

  try {
    return await request<T>(input.path, input.body, input.token);
  } catch (err) {
    if (!(err instanceof TikTokApiError)) throw err;
    const decision = classifyTikTokRetry({
      httpStatus: err.httpStatus ?? 200,
      code: err.code,
      attempt: 0,
    });
    if (!decision.retry) throw err;
    await sleep(decision.delayMs);
    return request<T>(input.path, input.body, input.token);
  }
}
