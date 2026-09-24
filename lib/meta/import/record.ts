import type {
  MetaImportGraphGet,
  MetaImportGraphPost,
  MetaImportRecordedCall,
  MetaImportRequest,
} from "./types.ts";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wrap Graph GET/POST so every import read is recorded, in order.
 * Defaults are injected by the route — this file does not import
 * `lib/meta/client.ts` (parameter-property `MetaApiError` cannot be
 * loaded under `--experimental-strip-types`).
 */
export function recordingMetaGraph(inner: MetaImportRequest): {
  request: MetaImportRequest;
  calls: MetaImportRecordedCall[];
} {
  const calls: MetaImportRecordedCall[] = [];

  const get: MetaImportGraphGet = async (path, params, token) => {
    const startedAt = Date.now();
    const call: MetaImportRecordedCall = {
      method: "GET",
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
      const data = await inner.get(path, params, token);
      call.ok = true;
      call.data = data;
      return data;
    } catch (err) {
      call.error = { message: errorMessage(err) };
      throw err;
    } finally {
      call.durationMs = Date.now() - startedAt;
    }
  };

  const post: MetaImportGraphPost = async (path, body, token) => {
    const startedAt = Date.now();
    const call: MetaImportRecordedCall = {
      method: "POST",
      path,
      params: body,
      ok: false,
      data: null,
      error: null,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: 0,
    };
    calls.push(call);
    try {
      const data = await inner.post(path, body, token);
      call.ok = true;
      call.data = data;
      return data;
    } catch (err) {
      call.error = { message: errorMessage(err) };
      throw err;
    } finally {
      call.durationMs = Date.now() - startedAt;
    }
  };

  return { request: { get, post }, calls };
}
