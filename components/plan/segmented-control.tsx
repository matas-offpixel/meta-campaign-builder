import { VIZ_TYPE } from "@/lib/viz/tokens";

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  allowDeselect = false,
}: {
  value: T | null;
  options: { id: T; label: string; glyph?: string }[];
  onChange: (next: T | null) => void;
  ariaLabel: string;
  allowDeselect?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-border bg-muted/40 p-[2px]"
    >
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`${VIZ_TYPE.label} px-2.5 py-1 ${
              selected
                ? "rounded-[4px] bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => {
              if (allowDeselect && selected) onChange(null);
              else onChange(option.id);
            }}
          >
            {option.glyph ? (
              <span aria-hidden="true" className="mr-1">
                {option.glyph}
              </span>
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
