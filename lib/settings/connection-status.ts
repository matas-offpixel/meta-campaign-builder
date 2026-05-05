import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { GOOGLE_ADS_OAUTH_SCOPE } from "@/lib/google-ads/oauth";
import { TIKTOK_OAUTH_SCOPE } from "@/lib/tiktok/oauth";

const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "ads_management",
  "ads_read",
  "instagram_basic",
  "business_management",
];

export type ConnectionBadgeStatus =
  | "connected"
  | "expiring_soon"
  | "disconnected";

export interface ConnectionAccount {
  id: string;
  name: string;
  meta?: string;
}

export interface PlatformConnectionStatus {
  id: "facebook" | "tiktok" | "google_ads" | "ticketing";
  title: string;
  description: string;
  status: ConnectionBadgeStatus;
  connectedAs: string | null;
  connectedAt: string | null;
  tokenExpiresAt: string | null;
  scopes: string[];
  accounts: ConnectionAccount[];
  reconnectHref: string | null;
  detailsHref: string | null;
  disconnectEnabled: boolean;
  statusNote?: string;
}

interface FacebookTokenRow {
  expires_at: string | null;
  updated_at: string | null;
}

interface TikTokAccountRow {
  id: string;
  account_name: string;
  tiktok_advertiser_id: string | null;
  created_at: string;
  updated_at: string;
  credentials_encrypted?: string | null;
  access_token_encrypted?: string | null;
}

interface GoogleAdsAccountRow {
  id: string;
  account_name: string;
  google_customer_id: string | null;
  created_at: string;
  updated_at: string;
  credentials_encrypted?: string | null;
  login_customer_id?: string | null;
}

interface TicketingConnectionRow {
  id: string;
  provider: string;
  status: string;
  external_account_id: string | null;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
  last_error: string | null;
}

interface ClientMetaAccountRow {
  name: string;
  meta_ad_account_id: string | null;
  meta_business_id: string | null;
  meta_pixel_id: string | null;
}

function asAny(supabase: SupabaseClient<Database>) {
  // Supabase generated types lag a few OAuth credential columns; keep
  // the casts local so callers still get a typed settings surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as unknown as any;
}

function statusFromExpiry(expiresAt: string | null): ConnectionBadgeStatus {
  if (!expiresAt) return "connected";
  const expiresMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    return "disconnected";
  }
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return expiresMs - Date.now() <= sevenDaysMs ? "expiring_soon" : "connected";
}

function providerLabel(provider: string): string {
  switch (provider) {
    case "eventbrite":
      return "Eventbrite";
    case "fourthefans":
    case "foursomething_internal":
      return "4thefans";
    case "manual":
      return "Manual";
    default:
      return provider.replaceAll("_", " ");
  }
}

function userDisplayName(user: User): string {
  const metadata = user.user_metadata as Record<string, unknown>;
  return (
    (typeof metadata.full_name === "string" && metadata.full_name.trim()) ||
    (typeof metadata.name === "string" && metadata.name.trim()) ||
    user.email ||
    user.id
  );
}

export async function getPlatformConnectionStatuses(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<PlatformConnectionStatus[]> {
  const sb = asAny(supabase);
  const [
    facebookResult,
    clientsResult,
    tiktokResult,
    googleResult,
    ticketingResult,
  ] = await Promise.all([
    sb
      .from("user_facebook_tokens")
      .select("updated_at, expires_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    sb
      .from("clients")
      .select("name, meta_ad_account_id, meta_business_id, meta_pixel_id")
      .eq("user_id", user.id)
      .not("meta_ad_account_id", "is", null)
      .order("name", { ascending: true }),
    sb
      .from("tiktok_accounts")
      .select("id, account_name, tiktok_advertiser_id, created_at, updated_at, credentials_encrypted, access_token_encrypted")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    sb
      .from("google_ads_accounts")
      .select("id, account_name, google_customer_id, created_at, updated_at, credentials_encrypted, login_customer_id")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    sb
      .from("client_ticketing_connections")
      .select("id, provider, status, external_account_id, created_at, updated_at, last_synced_at, last_error")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
  ]);

  const facebookToken = (facebookResult.data ?? null) as FacebookTokenRow | null;
  const clientMetaAccounts = (clientsResult.data ?? []) as ClientMetaAccountRow[];
  const tiktokAccounts = (tiktokResult.data ?? []) as TikTokAccountRow[];
  const googleAccounts = (googleResult.data ?? []) as GoogleAdsAccountRow[];
  const ticketingConnections = (ticketingResult.data ?? []) as TicketingConnectionRow[];

  const uniqueMetaAccounts = new Map<string, ConnectionAccount>();
  for (const client of clientMetaAccounts) {
    if (!client.meta_ad_account_id) continue;
    const existing = uniqueMetaAccounts.get(client.meta_ad_account_id);
    const clientLabel = existing?.meta
      ? `${existing.meta}, ${client.name}`
      : `Used by ${client.name}`;
    uniqueMetaAccounts.set(client.meta_ad_account_id, {
      id: client.meta_ad_account_id,
      name: client.meta_ad_account_id,
      meta: clientLabel,
    });
  }

  const connectedTicketing = ticketingConnections.filter(
    (row) => row.status !== "deleted",
  );
  const ticketingHasError = connectedTicketing.some(
    (row) => row.status === "error" || row.last_error,
  );

  return [
    {
      id: "facebook",
      title: "Facebook",
      description: "Marketing API, Pages and Instagram identity access.",
      status: facebookToken ? statusFromExpiry(facebookToken.expires_at) : "disconnected",
      connectedAs: facebookToken ? userDisplayName(user) : null,
      connectedAt: facebookToken?.updated_at ?? null,
      tokenExpiresAt: facebookToken?.expires_at ?? null,
      scopes: FACEBOOK_SCOPES,
      accounts: [...uniqueMetaAccounts.values()],
      reconnectHref: "/api/auth/facebook-start?next=/settings",
      detailsHref: "/settings/connections",
      disconnectEnabled: Boolean(facebookToken),
      statusNote: facebookResult.error?.message,
    },
    {
      id: "tiktok",
      title: "TikTok For Business",
      description: "Advertiser access for TikTok planning, launch and reporting.",
      status: tiktokAccounts.length > 0 ? "connected" : "disconnected",
      connectedAs: tiktokAccounts[0]?.account_name ?? null,
      connectedAt: tiktokAccounts[0]?.created_at ?? null,
      tokenExpiresAt: null,
      scopes: TIKTOK_OAUTH_SCOPE.split(","),
      accounts: tiktokAccounts.map((account) => ({
        id: account.id,
        name: account.account_name,
        meta: account.tiktok_advertiser_id
          ? `Advertiser ${account.tiktok_advertiser_id}`
          : "Advertiser id pending",
      })),
      reconnectHref: "/api/tiktok/oauth/start",
      detailsHref: "/tiktok",
      disconnectEnabled: false,
      statusNote: tiktokResult.error?.message,
    },
    {
      id: "google_ads",
      title: "Google Ads",
      description: "Search planning, OAuth customer access and reporting.",
      status: googleAccounts.length > 0 ? "connected" : "disconnected",
      connectedAs: googleAccounts[0]?.account_name ?? null,
      connectedAt: googleAccounts[0]?.created_at ?? null,
      tokenExpiresAt: null,
      scopes: [GOOGLE_ADS_OAUTH_SCOPE],
      accounts: googleAccounts.map((account) => ({
        id: account.id,
        name: account.account_name,
        meta: account.google_customer_id
          ? `Customer ${account.google_customer_id}`
          : "Customer id pending",
      })),
      reconnectHref: "/api/google-ads/oauth/start",
      detailsHref: "/google-ads",
      disconnectEnabled: false,
      statusNote: googleResult.error?.message,
    },
    {
      id: "ticketing",
      title: "Ticketing",
      description: "Eventbrite and 4thefans ticket sales connectors.",
      status:
        connectedTicketing.length === 0
          ? "disconnected"
          : ticketingHasError
            ? "expiring_soon"
            : "connected",
      connectedAs: connectedTicketing.length > 0 ? "Client ticketing connectors" : null,
      connectedAt: connectedTicketing[0]?.created_at ?? null,
      tokenExpiresAt: null,
      scopes: ["ticket sales read", "event listing read", "rollup sync"],
      accounts: connectedTicketing.map((connection) => ({
        id: connection.id,
        name: providerLabel(connection.provider),
        meta: [
          connection.external_account_id
            ? `External ${connection.external_account_id}`
            : null,
          connection.status,
          connection.last_synced_at ? `synced ${connection.last_synced_at}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
      reconnectHref: null,
      detailsHref: "/clients",
      disconnectEnabled: false,
      statusNote:
        ticketingResult.error?.message ??
        connectedTicketing.find((row) => row.last_error)?.last_error ??
        undefined,
    },
  ];
}
