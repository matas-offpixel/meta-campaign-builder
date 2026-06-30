"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

type LinkProps = ComponentProps<typeof Link>;

type Props = Omit<LinkProps, "prefetch"> & {
  /**
   * When `true` (default), eagerly prefetch the route — both via the
   * `<Link prefetch>` viewport pass AND a `router.prefetch(href)` on hover.
   * The hover call is what actually warms a `force-dynamic` route's RSC
   * payload (a plain `prefetch` only fetches up to the loading boundary),
   * giving tab/region switches a sub-100ms feel.
   *
   * Pass `false` for surfaces that must keep Next's conservative default —
   * notably the public `/share/*` portal, where aggressive prefetch could
   * spike Vercel usage for anonymous viewers.
   */
  prefetchOnHover?: boolean;
};

/**
 * `<Link>` wrapper that adds hover-driven `router.prefetch`. Lives as a
 * client primitive so it can be dropped into server-component nav bars
 * (region selector, sub-tab bar) that can't call `useRouter` directly.
 */
export function HoverPrefetchLink({
  prefetchOnHover = true,
  href,
  onMouseEnter,
  ...rest
}: Props) {
  const router = useRouter();

  if (!prefetchOnHover) {
    return <Link href={href} onMouseEnter={onMouseEnter} {...rest} />;
  }

  return (
    <Link
      href={href}
      prefetch
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
        if (typeof href === "string") router.prefetch(href);
        onMouseEnter?.(e);
      }}
      {...rest}
    />
  );
}
