export interface TikTokLaunchEntity {
  kind: "campaign" | "adgroup" | "ad";
  id: string;
  name: string;
  status: "created";
}
