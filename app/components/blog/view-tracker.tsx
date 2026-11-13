"use client";
import { useEffect } from "react";
export function BlogViewTracker({ path }: { path: string }) {
  useEffect(() => {
    if (navigator.doNotTrack === "1") return;
    let sent = false;
    function track() {
      if (sent || document.visibilityState !== "visible") return;
      sent = true;
      try {
        const key = "blog-visitor";
        const saved = JSON.parse(localStorage.getItem(key) || "null");
        const visitor = saved?.expires > Date.now() && typeof saved.id === "string" ? saved.id : crypto.randomUUID();
        localStorage.setItem(key, JSON.stringify({ id: visitor, expires: saved?.expires > Date.now() ? saved.expires : Date.now() + 90 * 86400000 }));
        const referrer = document.referrer ? new URL(document.referrer).hostname : "direct";
        void fetch("/api/blog/views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, visitor, referrer }), keepalive: true }).catch(() => {});
      } catch { /* Analytics must never interrupt reading or require storage permission. */ }
    }
    track();
    document.addEventListener("visibilitychange", track);
    return () => document.removeEventListener("visibilitychange", track);
  }, [path]);
  return null;
}
