/**
 * Types for WhatsApp community alias redirects (migration 150).
 */

export type WaCommunityAliasEventAction =
  | "created"
  | "updated"
  | "repointed"
  | "destination_added"
  | "destination_removed"
  | "activated"
  | "deactivated";

export interface WaCommunityAliasDestination {
  id: string;
  alias_id: string;
  invite_code: string;
  label: string | null;
  sort_order: number;
  is_active: boolean;
  activated_at: string | null;
  created_at: string;
}

export interface WaCommunityAlias {
  id: string;
  slug: string;
  client_id: string | null;
  brand: string | null;
  is_active: boolean;
  notes: string | null;
  active_invite_code: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
}

/** Alias row plus staged destinations, for the ops UI. */
export interface WaCommunityAliasWithDestinations extends WaCommunityAlias {
  destinations: WaCommunityAliasDestination[];
  /** Client display name when joined; null if unlinked. */
  client_name: string | null;
}

export interface WaCommunityAliasEvent {
  id: string;
  alias_id: string;
  user_id: string | null;
  action: WaCommunityAliasEventAction;
  detail: Record<string, unknown>;
  at: string;
}
