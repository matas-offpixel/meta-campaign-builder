export const GOOGLE_ADS_RECONNECT_ERROR_COOKIE = "google_ads_reconnect_error";

export function googleAdsReconnectErrorCookie(message: string): {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    secure: boolean;
    path: string;
    maxAge: number;
  };
} {
  return {
    name: GOOGLE_ADS_RECONNECT_ERROR_COOKIE,
    value: message.slice(0, 500),
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}
