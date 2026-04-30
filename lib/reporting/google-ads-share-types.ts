import type { CampaignInsightsRow } from "@/lib/reporting/event-insights";

export interface GoogleAdsCreativeRow {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  youtubeUrl: string | null;
  thumbnailUrl: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  engagements: number;
  videoViews: number | null;
}

export interface GoogleAdsBreakdownRow {
  label: string;
  spend: number;
  impressions: number;
  clicks: number;
}

export interface GoogleAdsReportBlockData {
  sourceLabel: string;
  totals: {
    spend: number;
    impressions: number;
    clicks: number;
    engagements: number;
    reach: number | null;
    frequency: number | null;
    cpm: number | null;
    ctr: number | null;
    costPerEngagement: number | null;
    costPer1000Reached: number | null;
    videoViews25: number | null;
    videoViews50: number | null;
    videoViews75: number | null;
    videoViews100: number | null;
  };
  campaigns: CampaignInsightsRow[];
  creatives?: GoogleAdsCreativeRow[];
  demographics?: {
    regions: GoogleAdsBreakdownRow[];
    ageRanges: GoogleAdsBreakdownRow[];
    genders: GoogleAdsBreakdownRow[];
  };
}
