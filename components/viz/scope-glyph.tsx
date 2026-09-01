const SIZE = { sm: 12, md: 16, lg: 22 } as const;

export type AutomationScopeGlyph = "ad_set" | "campaign";

export function ScopeGlyph({
  scope,
  size = "sm",
  className = "",
}: {
  scope: AutomationScopeGlyph;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const px = SIZE[size];
  const label = scope === "campaign" ? "Campaign" : "Ad set";
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 16 16"
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={label}
    >
      {scope === "campaign" ? (
        <rect
          x="2.5"
          y="5"
          width="11"
          height="6"
          rx="1.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      ) : (
        <>
          <rect x="2.5" y="3" width="11" height="2.4" rx="0.6" fill="currentColor" />
          <rect x="2.5" y="6.8" width="11" height="2.4" rx="0.6" fill="currentColor" opacity="0.7" />
          <rect x="2.5" y="10.6" width="11" height="2.4" rx="0.6" fill="currentColor" opacity="0.45" />
        </>
      )}
    </svg>
  );
}
