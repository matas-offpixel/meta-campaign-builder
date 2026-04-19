"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Shared URL-param mutator. Every dashboard surface that drives state
 * via the URL (calendar, /events filters, /clients filters) uses this
 * to ensure unrelated params are preserved across mutations.
 *
 * Usage:
 *   const { writeParams } = useWriteParams();
 *   writeParams((p) => {
 *     if (next === "all") p.delete("status");
 *     else p.set("status", next);
 *   });
 *
 * Canonical clean URL convention: callers are expected to delete a
 * param when its value matches the default, so the URL stays minimal
 * for the most common state.
 */
export function useWriteParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const writeParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  return { writeParams };
}
