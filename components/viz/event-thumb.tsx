import { VIZ_TYPE } from "@/lib/viz/tokens";

export function EventThumb({
  url,
  name,
  size = "md",
}: {
  url: string | null | undefined;
  name: string | null | undefined;
  size?: "sm" | "md";
}) {
  const px = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name ? `${name} artwork` : "Event artwork"}
        className={`${px} shrink-0 rounded object-cover`}
      />
    );
  }
  return (
    <span
      className={`${px} inline-flex shrink-0 items-center justify-center rounded border border-dashed border-border bg-muted ${VIZ_TYPE.micro}`}
      aria-label={name ? `${name} (no artwork)` : "No artwork"}
    />
  );
}
