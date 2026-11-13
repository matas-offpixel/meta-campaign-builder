/** Props for components/internal-counts/review-list.tsx, built by review-words.ts and review-read.ts. */

export interface ActionView {
  /** The button's words, exactly as R1 writes them. */
  label: string;
  /** The form's `action` field; null for a plain link (href). */
  action: string | null;
  href?: string;
  /** Hidden fields sent with the action. */
  fields?: Record<string, string>;
  /** Asks for an event (a select) and/or a figure (a number) beside the button. */
  needs?: Array<"event" | "figure">;
}

export interface SourceView {
  subject: string;
  /** The sender's domain, as R1 shows it. */
  sender: string;
  received: string;
  /** Opens the email in Gmail; null for an uploaded PDF. */
  emailUrl: string | null;
}

export interface ReviewItemView {
  id: string;
  kind: string;
  title: string;
  /** R1's 393 wording. */
  titleShort: string;
  body: string;
  bodyShort: string;
  source: SourceView;
  actions: ActionView[];
}

export interface CheckedItemView {
  id: string;
  /** "Checked · the 12 Nov sheet was replaced by a later email" */
  title: string;
  source: SourceView;
  /** "Matas, 12 Nov 14:02" */
  by: string;
  undo: ActionView | null;
}

export interface EventOption {
  id: string;
  label: string;
}

export interface InternalCountsView {
  /** The inbox the counts are read from, for "Internal Counts from {inbox} · internal only". */
  inbox: string | null;
  gmailConfigured: boolean;
  gmail: { email: string; lastPullAt: string | null; lastPullError: string | null } | null;
  flash: string | null;
  open: ReviewItemView[];
  checked: CheckedItemView[];
  events: EventOption[];
}
