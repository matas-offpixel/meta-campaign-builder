/** Props for components/internal-counts/review-list.tsx, shaped by review-read.ts. */

export interface ReviewItemView {
  id: string;
  kind: string;
  blocking: boolean;
  showName: string | null;
  message: string;
}

export interface ReviewGroupView {
  reportId: string;
  subject: string;
  receivedAt: string;
  items: ReviewItemView[];
}

export interface RecentCountView {
  reportId: string;
  subject: string;
  receivedAt: string;
  countDate: string | null;
  written: number;
  inReview: number;
}

export interface InternalCountsView {
  gmailConfigured: boolean;
  gmail: { email: string; lastPullAt: string | null; lastPullError: string | null } | null;
  flash: string | null;
  groups: ReviewGroupView[];
  recent: RecentCountView[];
}
