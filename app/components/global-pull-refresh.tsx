"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function GlobalPullRefresh() {
  const [refreshing, setRefreshing] = useState(false);
  const pullStartYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const isPullingRef = useRef(false);
  const pullTriggeredRef = useRef(false);
  const refreshingRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    const pullThresholdPx = 72;
    const maxVisualPullPx = 120;

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1 || refreshingRef.current) return;
      if (window.scrollY > 0) return;
      pullStartYRef.current = event.touches[0]?.clientY ?? null;
      pullDistanceRef.current = 0;
      isPullingRef.current = false;
      pullTriggeredRef.current = false;
    }

    function onTouchMove(event: TouchEvent) {
      const startY = pullStartYRef.current;
      if (startY === null || refreshingRef.current) return;
      const currentY = event.touches[0]?.clientY ?? startY;
      const deltaY = currentY - startY;

      if (deltaY <= 0 || window.scrollY > 0) {
        if (!isPullingRef.current) return;
        isPullingRef.current = false;
        pullDistanceRef.current = 0;
        return;
      }

      isPullingRef.current = true;
      const visual = Math.min(maxVisualPullPx, Math.floor(deltaY * 0.56));
      pullDistanceRef.current = visual;
      if (visual >= pullThresholdPx) {
        pullTriggeredRef.current = true;
      }
      event.preventDefault();
    }

    function onTouchEnd() {
      if (!isPullingRef.current) {
        pullStartYRef.current = null;
        return;
      }

      const shouldRefresh = pullTriggeredRef.current;
      pullStartYRef.current = null;
      isPullingRef.current = false;
      pullTriggeredRef.current = false;
      pullDistanceRef.current = 0;

      if (!shouldRefresh || refreshingRef.current) return;

      refreshingRef.current = true;
      setRefreshing(true);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(() => {
        // Clear spinner even if reload is blocked by the platform/browser.
        refreshingRef.current = false;
        setRefreshing(false);
        window.location.reload();
        refreshTimerRef.current = null;
      }, 2000);
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center"
      style={{
        opacity: refreshing ? 1 : 0,
        transform: "translateY(12px)",
        transition: "opacity 140ms ease",
      }}
    >
      <Loader2 className={`h-5 w-5 text-zinc-700 ${refreshing ? "animate-spin" : ""}`} />
    </div>
  );
}
