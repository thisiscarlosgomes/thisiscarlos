"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/app/components/site-header";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidXProfileUrl(value: string): boolean {
  if (!isValidHttpUrl(value)) return false;
  const url = new URL(value.trim());
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "x.com" && host !== "twitter.com") return false;
  return url.pathname.replaceAll("/", "").length > 0;
}

function maybeAddHttps(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function parseUsdInput(value: string): { value: number | null; valid: boolean } {
  const cleaned = value.replace(/[,\s$]/g, "");
  if (!cleaned) return { value: null, valid: true };
  if (!/^\d+$/.test(cleaned)) return { value: null, valid: false };
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return { value: null, valid: false };
  return { value: Math.floor(parsed), valid: true };
}

export default function PitchPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [projectName, setProjectName] = useState("");
  const [details, setDetails] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [raiseAmountUsd, setRaiseAmountUsd] = useState("");
  const [valuationUsd, setValuationUsd] = useState("");
  const [company, setCompany] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");

  const raiseParsed = useMemo(() => parseUsdInput(raiseAmountUsd), [raiseAmountUsd]);
  const valuationParsed = useMemo(() => parseUsdInput(valuationUsd), [valuationUsd]);
  const emailError =
    email && !isValidEmail(email) ? "enter a valid email (for example: founder@company.com)." : "";
  const websiteError =
    websiteUrl && !isValidHttpUrl(websiteUrl) ? "enter a full website url (for example: https://example.com)." : "";
  const xUrlError =
    xUrl && !isValidXProfileUrl(xUrl) ? "enter a valid x profile url (for example: https://x.com/username)." : "";
  const valuationError =
    valuationUsd && !valuationParsed.valid ? "enter valuation as a usd number (digits only, commas are ok)." : "";
  const canSubmit =
    !submitting &&
    !!name.trim() &&
    !!email.trim() &&
    !!projectName.trim() &&
    !!details.trim() &&
    !!websiteUrl.trim() &&
    !!raiseAmountUsd.trim() &&
    !!valuationUsd.trim() &&
    !emailError &&
    !websiteError &&
    !xUrlError &&
    !valuationError &&
    raiseParsed.valid &&
    valuationParsed.valid;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    if (emailError || websiteError || xUrlError || valuationError || !raiseParsed.valid || !valuationParsed.valid) {
      setStatus("please fix the highlighted fields first.");
      return;
    }

    setSubmitting(true);
    setStatus("");

    try {
      const response = await fetch("/api/pitch/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          projectName,
          details,
          websiteUrl,
          xUrl,
          raiseAmountUsd: raiseParsed.value,
          valuationUsd: valuationParsed.value,
          company,
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "could not submit pitch");
      }
      setStatus("pitch received. call me on /c and mention your email so i can reference it.");
      setProjectName("");
      setDetails("");
      setWebsiteUrl("");
      setXUrl("");
      setRaiseAmountUsd("");
      setValuationUsd("");
      setCompany("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "could not submit pitch");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 pb-20 pt-10 sm:px-10">
      <SiteHeader showCallButton={false} />

      <section className="rounded-lg border border-zinc-200 p-4">
        <h1 className="text-sm font-semibold text-zinc-900">pitch me</h1>
        <p className="mt-2 text-sm text-zinc-700">
          share your startup and i&apos;ll review it. then call me on <Link href="/c" className="underline">/c</Link>.
        </p>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-zinc-600">name</span>
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-zinc-900 focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-600">email</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-zinc-900 focus:ring-2"
              />
              {emailError ? <p className="mt-1 text-xs text-red-600">{emailError}</p> : null}
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-zinc-600">project name</span>
            <input
              required
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-zinc-900 focus:ring-2"
            />
          </label>

          <label className="block">
            <span className="text-xs text-zinc-600">what are you building, who is it for, traction, and where you need help</span>
            <textarea
              required
              rows={6}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-zinc-900 focus:ring-2"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-1">
            <label className="block">
              <span className="text-xs text-zinc-600">website url</span>
              <input
                required
                value={websiteUrl}
                onChange={(event) => setWebsiteUrl(event.target.value)}
                onBlur={() => setWebsiteUrl((value) => maybeAddHttps(value))}
                placeholder="https://..."
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-zinc-900 focus:ring-2"
              />
              {websiteError ? <p className="mt-1 text-xs text-red-600">{websiteError}</p> : null}
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-zinc-600">x profile url (optional)</span>
              <input
                value={xUrl}
                onChange={(event) => setXUrl(event.target.value)}
                onBlur={() => setXUrl((value) => maybeAddHttps(value))}
                placeholder="https://x.com/..."
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-zinc-900 focus:ring-2"
              />
              {xUrlError ? <p className="mt-1 text-xs text-red-600">{xUrlError}</p> : null}
            </label>
            <label className="block">
              <span className="text-xs text-zinc-600">raising amount in usd</span>
              <input
                required
                inputMode="numeric"
                value={raiseAmountUsd}
                onChange={(event) => setRaiseAmountUsd(event.target.value)}
                placeholder="250000"
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-zinc-900 focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-600">valuation in usd</span>
              <input
                required
                inputMode="numeric"
                value={valuationUsd}
                onChange={(event) => setValuationUsd(event.target.value)}
                placeholder="5000000"
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-zinc-900 focus:ring-2"
              />
              {valuationError ? <p className="mt-1 text-xs text-red-600">{valuationError}</p> : null}
            </label>
          </div>

          <label className="hidden">
            company
            <input value={company} onChange={(event) => setCompany(event.target.value)} />
          </label>

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-2 block w-full rounded-full bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? "submitting..." : "submit pitch"}
          </button>
        </form>

        {status ? <p className="mt-3 text-xs text-zinc-600">{status}</p> : null}
      </section>
    </main>
  );
}
