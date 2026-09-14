import { TikTokApiError, tiktokGet } from "../client.ts";

type TikTokGet = typeof tiktokGet;

export type TikTokRecordedCall = {
  path: string;
  /** Exactly what went on the wire. The token is a header, not a param. */
  params: Record<string, unknown>;
  ok: boolean;
  /**
   * Verbatim `data` as TikTok returned it — unparsed, unmapped, no key
   * walking. This is what a captured fixture is made of.
   */
  data: unknown;
  /**
   * The outer envelope, which `tiktokGet` only surfaces on failure: it
   * returns `data` directly when `code` is 0 and throws a
   * `TikTokApiError` carrying `code` / `message` / `request_id`
   * otherwise. A rejected `fields` name arrives here — that is how the
   * `/adgroup/get/` accepted-field list was learned.
   */
  error: {
    message: string;
    code: number | null;
    requestId: string | null;
    httpStatus: number | null;
  } | null;
  startedAt: string;
  durationMs: number;
};

/** Wrap `tiktokGet` so every import read is recorded, in order. */
export function recordingTikTokGet(inner: TikTokGet = tiktokGet): {
  request: TikTokGet;
  calls: TikTokRecordedCall[];
} {
  const calls: TikTokRecordedCall[] = [];
  const request = (async (
    path: string,
    params: Record<string, unknown>,
    token: string,
  ) => {
    const startedAt = Date.now();
    const call: TikTokRecordedCall = {
      path,
      params,
      ok: false,
      data: null,
      error: null,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: 0,
    };
    calls.push(call);
    try {
      const data = await inner(
        path,
        params as Parameters<TikTokGet>[1],
        token,
      );
      call.ok = true;
      call.data = data;
      return data;
    } catch (err) {
      call.error =
        err instanceof TikTokApiError
          ? {
              message: err.message,
              code: err.code ?? null,
              requestId: err.requestId ?? null,
              httpStatus: err.httpStatus ?? null,
            }
          : {
              message: err instanceof Error ? err.message : String(err),
              code: null,
              requestId: null,
              httpStatus: null,
            };
      throw err;
    } finally {
      call.durationMs = Date.now() - startedAt;
    }
  }) as TikTokGet;
  return { request, calls };
}
