"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server page once after `seconds`. The page gives it a new `key` on each render, so it keeps trying while it fails. */
export function RefreshSoon({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => {
      if (!document.hidden) router.refresh();
    }, seconds * 1000);
    return () => clearTimeout(t);
  }, [router, seconds]);
  return null;
}
