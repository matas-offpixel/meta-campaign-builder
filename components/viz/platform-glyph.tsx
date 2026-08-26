import { VIZ_PLATFORM_LABEL, type VizPlatform } from "@/lib/viz/tokens";

const SIZE = { sm: 12, md: 16, lg: 22 } as const;

export function PlatformGlyph({
  platform,
  size = "md",
  className = "",
}: {
  platform: VizPlatform;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const px = SIZE[size];
  const label = VIZ_PLATFORM_LABEL[platform];
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 16 16"
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={label}
    >
      {platform === "meta" ? (
        <path
          d="M3 10.5c1.4-2.8 3-6.5 5-6.5s3.6 3.7 5 6.5M5.2 8.2h5.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ) : platform === "tiktok" ? (
        <path
          d="M9 3.2v6.1a2.4 2.4 0 1 1-2.4-2.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ) : (
        <>
          <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.2 8h9.6M8 3.2c1.6 1.6 2.4 3.2 2.4 4.8S9.6 11.2 8 12.8C6.4 11.2 5.6 9.6 5.6 8S6.4 4.8 8 3.2Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </>
      )}
    </svg>
  );
}
