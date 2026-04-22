import "server-only";

/**
 * lib/enrichment/weather.ts
 *
 * Open-Meteo wrapper. No API key required. Picks the right endpoint
 * based on how far in the future the event is:
 *   - Within 16 days  → /v1/forecast              (concrete numbers)
 *   - Beyond 16 days  → climate-api .../v1/climate (climatology)
 *
 * The shape returned to callers is the same in both cases — the only
 * differentiator is the `is_forecast_or_climate` discriminator so the
 * UI can render a "Forecast" vs "Climate estimate" badge without
 * caring about which URL was hit.
 */

const FORECAST_HORIZON_DAYS = 16;

export interface WeatherSummary {
  temperature_c: { min: number | null; max: number | null; mean: number | null };
  /** Forecast: % probability (0-100). Climate: cumulative mm. */
  precipitation_mm_or_probability: number | null;
  weather_code: number | null;
  is_forecast_or_climate: "forecast" | "climate";
  /** ISO date the prediction is for (YYYY-MM-DD). */
  date: string;
}

interface ForecastArgs {
  lat: number;
  lng: number;
  /** YYYY-MM-DD in the venue's local date — same string we send to Open-Meteo. */
  date: string;
}

function daysFromToday(date: string): number {
  // Diff is computed at UTC midnight to avoid DST flips bumping the
  // count by one. Open-Meteo also treats `start_date`/`end_date` as
  // local-tz dates so this is the right grain.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return Number.POSITIVE_INFINITY;
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export async function getForecast(args: ForecastArgs): Promise<WeatherSummary | null> {
  const { lat, lng, date } = args;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const dDays = daysFromToday(date);
  if (dDays <= FORECAST_HORIZON_DAYS) {
    return await fetchForecast(lat, lng, date);
  }
  return await fetchClimate(lat, lng, date);
}

async function fetchForecast(lat: number, lng: number, date: string): Promise<WeatherSummary | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  );
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast failed: HTTP ${res.status}`);
  }
  const j = (await res.json()) as {
    daily?: {
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
    };
  };
  const d = j.daily;
  const tmax = d?.temperature_2m_max?.[0] ?? null;
  const tmin = d?.temperature_2m_min?.[0] ?? null;
  return {
    temperature_c: {
      min: typeof tmin === "number" ? tmin : null,
      max: typeof tmax === "number" ? tmax : null,
      mean:
        typeof tmin === "number" && typeof tmax === "number"
          ? (tmin + tmax) / 2
          : null,
    },
    precipitation_mm_or_probability:
      typeof d?.precipitation_probability_max?.[0] === "number"
        ? d.precipitation_probability_max[0]
        : null,
    weather_code:
      typeof d?.weather_code?.[0] === "number" ? d.weather_code[0] : null,
    is_forecast_or_climate: "forecast",
    date,
  };
}

async function fetchClimate(lat: number, lng: number, date: string): Promise<WeatherSummary | null> {
  // Climate API needs a date range that includes the target day.
  const url = new URL("https://climate-api.open-meteo.com/v1/climate");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  url.searchParams.set("models", "CMCC_CM2_VHR4");
  url.searchParams.set("daily", "temperature_2m_mean,precipitation_sum");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    // Climate API can 4xx for far-future dates the model doesn't
    // cover; treat as "no data" so the UI shows the empty state
    // rather than crashing the whole panel.
    return null;
  }
  const j = (await res.json()) as {
    daily?: {
      temperature_2m_mean?: number[];
      precipitation_sum?: number[];
    };
  };
  const tmean = j.daily?.temperature_2m_mean?.[0] ?? null;
  const psum = j.daily?.precipitation_sum?.[0] ?? null;
  return {
    temperature_c: {
      min: null,
      max: null,
      mean: typeof tmean === "number" ? tmean : null,
    },
    precipitation_mm_or_probability:
      typeof psum === "number" ? psum : null,
    weather_code: null,
    is_forecast_or_climate: "climate",
    date,
  };
}
