import { TikTokApiError } from "../client.ts";
import type { BodyValue } from "../client.ts";
import type { TikTokPost } from "../write/idempotency.ts";

export interface MockTikTokCall {
  path: string;
  body: Record<string, BodyValue>;
  token: string;
}

export function createMockTikTokClient(options: {
  failOnce?: Record<string, TikTokApiError>;
  failAlways?: Record<string, TikTokApiError>;
} = {}): { tiktokPost: TikTokPost; calls: MockTikTokCall[] } {
  const calls: MockTikTokCall[] = [];
  const failedOnce = new Set<string>();

  const mockPost: TikTokPost = async <T,>(
    path: string,
    body: Record<string, BodyValue>,
    token: string,
  ): Promise<T> => {
    calls.push({ path, body, token });

    const alwaysError = options.failAlways?.[path];
    if (alwaysError) throw alwaysError;

    const onceError = options.failOnce?.[path];
    if (onceError && !failedOnce.has(path)) {
      failedOnce.add(path);
      throw onceError;
    }

    if (path === "/campaign/create/") {
      return { campaign_id: "campaign_mock_1" } as T;
    }
    if (path === "/adgroup/create/") {
      return { adgroup_id: `adgroup_mock_${calls.length}` } as T;
    }
    if (path === "/ad/create/") {
      return { ad_id: `ad_mock_${calls.length}` } as T;
    }
    if (path === "/campaign/delete/") {
      return { ok: true } as T;
    }
    return {} as T;
  };

  return { tiktokPost: mockPost, calls };
}
