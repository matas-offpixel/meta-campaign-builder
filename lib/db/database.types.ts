// Generated from Supabase (project zbtldbfjbhfvpksmdvnt) via
// `mcp generate_typescript_types` on 2026-04-18.
//
// Regenerate with `supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt`
// or via the Supabase MCP. Keep in sync with supabase/schema.sql.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.4";
  };
  public: {
    Tables: {
      campaign_drafts: {
        Row: {
          ad_account_id: string | null;
          client_id: string | null;
          created_at: string;
          draft_json: Json;
          event_id: string | null;
          id: string;
          name: string | null;
          objective: string | null;
          status: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          ad_account_id?: string | null;
          client_id?: string | null;
          created_at?: string;
          draft_json?: Json;
          event_id?: string | null;
          id?: string;
          name?: string | null;
          objective?: string | null;
          status?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          ad_account_id?: string | null;
          client_id?: string | null;
          created_at?: string;
          draft_json?: Json;
          event_id?: string | null;
          id?: string;
          name?: string | null;
          objective?: string | null;
          status?: string | null;
          updated_at?: string;
          user_id?: string;
        };
      };
      campaign_templates: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          snapshot_json: Json;
          tags: string[] | null;
          template_json: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          snapshot_json?: Json;
          tags?: string[] | null;
          template_json?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          snapshot_json?: Json;
          tags?: string[] | null;
          template_json?: Json;
          updated_at?: string;
          user_id?: string;
        };
      };
      clients: {
        Row: {
          contact_email: string | null;
          contact_name: string | null;
          contact_whatsapp: string | null;
          created_at: string;
          default_ad_account_id: string | null;
          default_page_ids: string[];
          default_pixel_id: string | null;
          id: string;
          name: string;
          notes: string | null;
          primary_type: string;
          slug: string;
          status: string;
          types: string[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          contact_email?: string | null;
          contact_name?: string | null;
          contact_whatsapp?: string | null;
          created_at?: string;
          default_ad_account_id?: string | null;
          default_page_ids?: string[];
          default_pixel_id?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          primary_type: string;
          slug: string;
          status?: string;
          types?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          contact_email?: string | null;
          contact_name?: string | null;
          contact_whatsapp?: string | null;
          created_at?: string;
          default_ad_account_id?: string | null;
          default_page_ids?: string[];
          default_pixel_id?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          primary_type?: string;
          slug?: string;
          status?: string;
          types?: string[];
          updated_at?: string;
          user_id?: string;
        };
      };
      events: {
        Row: {
          announcement_at: string | null;
          budget_marketing: number | null;
          capacity: number | null;
          client_id: string;
          created_at: string;
          event_code: string | null;
          event_date: string | null;
          event_start_at: string | null;
          event_timezone: string | null;
          general_sale_at: string | null;
          genres: string[];
          id: string;
          name: string;
          notes: string | null;
          presale_at: string | null;
          signup_url: string | null;
          slug: string;
          status: string;
          ticket_url: string | null;
          updated_at: string;
          user_id: string;
          venue_city: string | null;
          venue_country: string | null;
          venue_name: string | null;
        };
        Insert: {
          announcement_at?: string | null;
          budget_marketing?: number | null;
          capacity?: number | null;
          client_id: string;
          created_at?: string;
          event_code?: string | null;
          event_date?: string | null;
          event_start_at?: string | null;
          event_timezone?: string | null;
          general_sale_at?: string | null;
          genres?: string[];
          id?: string;
          name: string;
          notes?: string | null;
          presale_at?: string | null;
          signup_url?: string | null;
          slug: string;
          status?: string;
          ticket_url?: string | null;
          updated_at?: string;
          user_id: string;
          venue_city?: string | null;
          venue_country?: string | null;
          venue_name?: string | null;
        };
        Update: {
          announcement_at?: string | null;
          budget_marketing?: number | null;
          capacity?: number | null;
          client_id?: string;
          created_at?: string;
          event_code?: string | null;
          event_date?: string | null;
          event_start_at?: string | null;
          event_timezone?: string | null;
          general_sale_at?: string | null;
          genres?: string[];
          id?: string;
          name?: string;
          notes?: string | null;
          presale_at?: string | null;
          signup_url?: string | null;
          slug?: string;
          status?: string;
          ticket_url?: string | null;
          updated_at?: string;
          user_id?: string;
          venue_city?: string | null;
          venue_country?: string | null;
          venue_name?: string | null;
        };
      };
      user_facebook_tokens: {
        Row: {
          provider_token: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          provider_token: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          provider_token?: string;
          updated_at?: string | null;
          user_id?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
