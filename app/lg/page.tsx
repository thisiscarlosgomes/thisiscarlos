"use client";

import { FormEvent, useState } from "react";

export default function VoiceNotesLoginPage() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/voice-notes/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({ error: "Login failed" }))) as { error?: string };
        setError(body.error ?? "Login failed");
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const nextPath = params.get("next") || "/v";
      window.location.href = nextPath;
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-10">
      <section className="w-full rounded-2xl border border-zinc-200 bg-white p-6">
        <h1 className="text-lg font-semibold text-zinc-900">Voice Notes Access</h1>
        <p className="mt-1 text-sm text-zinc-600">Owner-only page. Enter password to continue.</p>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="block w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-900 focus:ring-2"
            placeholder="Password"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="block w-full rounded-full bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Enter"}
          </button>
        </form>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>
    </main>
  );
}
