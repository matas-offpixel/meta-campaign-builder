import { AbsoluteFill } from "remotion";

/** 4theFans brand colour — no canonical token in repo; neutral dark blue fallback. */
const BACKGROUND = "#0f172a";
const TEXT = "#ffffff";
const MUTED = "rgba(255, 255, 255, 0.75)";

export interface FourTfCityStaticProps {
  city: string;
  venue: string;
  opponent_a: string;
  opponent_b: string;
  kick_off_at: string;
}

function formatKickOff(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(date);
}

export function FourTfCityStatic({
  city,
  venue,
  opponent_a,
  opponent_b,
  kick_off_at,
}: FourTfCityStaticProps) {
  const matchup = `${opponent_a} vs ${opponent_b}`;
  const location = [venue, city].filter(Boolean).join(", ");
  const kickOffLabel = formatKickOff(kick_off_at);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BACKGROUND,
        color: TEXT,
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 64,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 72,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          maxWidth: 920,
        }}
      >
        {matchup}
      </div>
      <div
        style={{
          marginTop: 32,
          fontSize: 36,
          fontWeight: 500,
          color: MUTED,
        }}
      >
        {location}
      </div>
      <div
        style={{
          marginTop: 20,
          fontSize: 32,
          fontWeight: 400,
          color: MUTED,
        }}
      >
        {kickOffLabel}
      </div>
      <div
        style={{
          position: "absolute",
          right: 48,
          bottom: 48,
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "0.08em",
          opacity: 0.9,
        }}
      >
        4TF
      </div>
    </AbsoluteFill>
  );
}
