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
  /** Null when the meta line is "{received}" only (a near miss, R1a). */
  subject: string | null;
  /** The sender's domain, as R1 shows it. */
  sender: string;
  received: string;
  /** Opens the email in Gmail; null for an uploaded PDF. */
  emailUrl: string | null;
  /** Ruling d: "forwarded by {sender}, {d Mon}" on a forward's meta line. */
  forwardedBy?: string | null;
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
  /** Ruling d: a line under the item ("Arrived after the {later date} count. …"). */
  note?: string | null;
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
  /** R1a's subline under "To check · {n}" (see review-words.ts gmailStatusLine). */
  statusLine: string;
  /** The result of the last upload or action, if any. */
  flash: string | null;
  open: ReviewItemView[];
  checked: CheckedItemView[];
  events: EventOption[];
}
