"use client";
import { useState } from "react";
export function SharePost({ title, url }: { title: string; url: string }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copied");
    } catch {
      setMessage(`Copy this link: ${url}`);
    }
  }
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title, url });
      else await copy();
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) await copy();
    }
  }
  const linkClass = "underline underline-offset-4 hover:text-zinc-950";
  return (
    <div className="text-sm text-zinc-600">
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-3"
        aria-label="Share this article"
      >
        <button onClick={copy} className={linkClass}>
          copy link
        </button>
        <a
          className={linkClass}
          href={`https://twitter.com/intent/tweet?${new URLSearchParams({ text: title, url })}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on X (opens a new tab)"
        >
          X
        </a>
        <a
          className={linkClass}
          href={`https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url })}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on LinkedIn (opens a new tab)"
        >
          LinkedIn
        </a>
        <button onClick={share} className={linkClass}>
          more
        </button>
      </div>
      <span role="status" aria-live="polite" className="mt-2 block break-all">
        {message}
      </span>
    </div>
  );
}
