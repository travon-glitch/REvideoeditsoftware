"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes the page every few seconds while `active` (e.g. while a video is being made). */
export function RefreshWhile({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
