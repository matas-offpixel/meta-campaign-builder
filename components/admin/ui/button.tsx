import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * components/admin/ui/button.tsx
 *
 * OP909 admin button system, aligned with the fan-facing LP: zero radius,
 * mono lowercase, hairline/solid fills. Four variants:
 *   - primary      solid black, white text (hover #333)
 *   - secondary    transparent, black text, 0.5px black border (hover #F5F5F5)
 *   - ghost        icon buttons — transparent, #666 text (hover #000)
 *   - destructive  solid #D33, white text (delete confirms)
 *
 * `accent` (optional) overrides the primary fill with the client's brand
 * accent — used for the single primary CTA per surface. Renders as a
 * <button> by default, or an <a>/<Link> when `href` is given.
 */

export type AdminButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive";

const BASE =
  "inline-flex items-center justify-center gap-2 font-[family-name:var(--admin-mono)] lowercase transition-colors disabled:opacity-40 disabled:pointer-events-none";

const VARIANT: Record<AdminButtonVariant, string> = {
  primary:
    "bg-black text-white text-[12px] px-5 py-2.5 hover:bg-[#333] tracking-[0.02em]",
  secondary:
    "bg-transparent text-black text-[12px] px-5 py-2.5 border-[0.5px] border-black hover:bg-[#f5f5f5] tracking-[0.02em]",
  ghost:
    "bg-transparent text-[#666] px-2 py-1.5 hover:text-black border-0",
  destructive:
    "bg-[#d33] text-white text-[12px] px-5 py-2.5 hover:bg-[#b82c28] tracking-[0.02em]",
};

type CommonProps = {
  variant?: AdminButtonVariant;
  /** Overrides the primary fill with the client accent (single CTA only). */
  accentFill?: string;
  className?: string;
  children: ReactNode;
};

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function AdminButton({
  variant = "primary",
  accentFill,
  className,
  children,
  style,
  ...rest
}: CommonProps & Omit<ComponentProps<"button">, "className" | "children">) {
  const accentStyle =
    variant === "primary" && accentFill
      ? { backgroundColor: accentFill, ...style }
      : style;
  return (
    <button
      className={cx(BASE, VARIANT[variant], className)}
      style={accentStyle}
      {...rest}
    >
      {children}
    </button>
  );
}

export function AdminLinkButton({
  variant = "primary",
  accentFill,
  className,
  children,
  href,
  style,
  ...rest
}: CommonProps &
  Omit<ComponentProps<typeof Link>, "className" | "children">) {
  const accentStyle =
    variant === "primary" && accentFill
      ? { backgroundColor: accentFill, ...style }
      : style;
  return (
    <Link
      href={href}
      className={cx(BASE, VARIANT[variant], className)}
      style={accentStyle}
      {...rest}
    >
      {children}
    </Link>
  );
}
