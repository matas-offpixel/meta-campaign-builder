import { tiktokGet } from "./client.ts";

export interface TikTokPixel {
  pixel_id: string;
  pixel_name: string;
  status: string | null;
}

interface TikTokPixelListRow {
  pixel_id?: string;
  pixel_name?: string;
  name?: string;
  status?: string;
}

interface TikTokPixelListResponse {
  list?: TikTokPixelListRow[];
}

type TikTokGet = typeof tiktokGet;

export async function fetchTikTokPixels(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokPixel[]> {
  const request = input.request ?? tiktokGet;
  const res = await request<TikTokPixelListResponse>(
    "/pixel/list/",
    { advertiser_id: input.advertiserId },
    input.token,
  );

  return (res.list ?? [])
    .filter((row): row is TikTokPixelListRow & { pixel_id: string } =>
      Boolean(row.pixel_id),
    )
    .map((row) => ({
      pixel_id: row.pixel_id,
      pixel_name: row.pixel_name ?? row.name ?? row.pixel_id,
      status: row.status ?? null,
    }))
    .sort((a, b) => a.pixel_name.localeCompare(b.pixel_name));
}
