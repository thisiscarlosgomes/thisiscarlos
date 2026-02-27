"use client";

import { useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/app/components/site-header";
import { toast } from "sonner";

type RecentCallersResponse = {
  callers: Array<{
    label: string;
    highlight: string;
    lastCallAtIso: string;
  }>;
};

type CallStatusResponse = {
  callsInFlight: number;
};

export default function LeaderboardPageClient() {
  const [callers, setCallers] = useState<RecentCallersResponse["callers"]>([]);
  const [callsInFlight, setCallsInFlight] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const inCallToastIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const response = await fetch("/api/call/status", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as CallStatusResponse;
        if (active) setCallsInFlight(Math.max(0, data.callsInFlight ?? 0));
      } catch {
        // ignore poll failures
      }
    }

    async function load() {
      try {
        const response = await fetch("/api/call/recent-callers?limit=100", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as RecentCallersResponse;
        if (active) setCallers(data.callers ?? []);
      } finally {
        if (active) setLoaded(true);
      }
    }

    void load();
    void loadStatus();
    const refresh = window.setInterval(() => {
      void load();
      void loadStatus();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, []);

  useEffect(() => {
    if (callsInFlight > 0 && !inCallToastIdRef.current) {
      inCallToastIdRef.current = toast.success("someone is on the call", {
        duration: Infinity,
      });
      return;
    }

    if (callsInFlight <= 0 && inCallToastIdRef.current) {
      toast.dismiss(inCallToastIdRef.current);
      inCallToastIdRef.current = null;
    }
  }, [callsInFlight]);

  function formatRecentTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "recently";
    const diffSeconds = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
    if (diffSeconds < 5) return "just now";
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 pb-20 pt-10 sm:px-10">
      <SiteHeader showCallButton={false} showPitchButton showCallsLink={false} />

      <section className="mt-4 rounded-lg border border-zinc-200 p-4">
        <h1 className="text-sm font-semibold text-zinc-900">All calls (anonymous)</h1>
        {!loaded ? (
          <div className="mt-3 animate-pulse space-y-2">
            <div className="h-14 rounded-md bg-zinc-100" />
            <div className="h-14 rounded-md bg-zinc-100" />
            <div className="h-14 rounded-md bg-zinc-100" />
          </div>
        ) : callers.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">no recent calls yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {callers.map((caller, index) => (
              <li
                key={`${caller.label}-${caller.lastCallAtIso}-${index}`}
                className="rounded-md border border-zinc-100 px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-900 font-mono tabular-nums tracking-wide">
                    {caller.label}
                  </span>
                  <span className="text-xs text-zinc-500">{formatRecentTime(caller.lastCallAtIso)}</span>
                </div>
                <p
                  className={`mt-1 text-xs ${
                    caller.highlight.trim().toLowerCase() === "on the call"
                      ? "font-semibold text-green-600 animate-pulse"
                      : "text-zinc-600"
                  }`}
                >
                  {caller.highlight}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
