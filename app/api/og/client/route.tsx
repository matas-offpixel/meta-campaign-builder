import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const name = searchParams.get("name") ?? "Client";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        {/* Top rule */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: "linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899)",
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
            padding: "0 80px",
          }}
        >
          {/* Brand */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                color: "#6366f1",
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: 6,
                textTransform: "uppercase",
              }}
            >
              OFF PIXEL
            </span>
          </div>

          {/* Divider */}
          <div
            style={{
              width: 40,
              height: 2,
              background: "#333",
              display: "flex",
            }}
          />

          {/* Client name */}
          <div
            style={{
              color: "#ffffff",
              fontSize: name.length > 14 ? 56 : 72,
              fontWeight: 800,
              letterSpacing: -2,
              textAlign: "center",
              lineHeight: 1.1,
              maxWidth: 900,
            }}
          >
            {name.toUpperCase()}
          </div>

          {/* Subtitle */}
          <div
            style={{
              color: "#6b7280",
              fontSize: 22,
              letterSpacing: 5,
              textTransform: "uppercase",
              marginTop: 4,
            }}
          >
            Campaign Dashboard
          </div>
        </div>

        {/* Bottom badge */}
        <div
          style={{
            position: "absolute",
            bottom: 32,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#22c55e",
              display: "flex",
            }}
          />
          <span style={{ color: "#4b5563", fontSize: 16, letterSpacing: 2 }}>
            LIVE DATA
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
