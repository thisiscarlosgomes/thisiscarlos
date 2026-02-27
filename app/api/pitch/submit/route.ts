import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { PitchSubmission } from "@/models/PitchSubmission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubmitBody = {
  name?: unknown;
  email?: unknown;
  projectName?: unknown;
  details?: unknown;
  websiteUrl?: unknown;
  xUrl?: unknown;
  raiseAmountUsd?: unknown;
  valuationUsd?: unknown;
  company?: unknown;
};

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function toRequiredUrl(value: unknown): string | null {
  const text = clip(String(value ?? ""), 300);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? text : null;
  } catch {
    return null;
  }
}

function toOptionalUrl(value: unknown): string | null {
  const text = clip(String(value ?? ""), 300);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? text : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Honeypot field for bot noise.
  if (String(body.company ?? "").trim()) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const name = clip(String(body.name ?? ""), 120);
  const email = clip(String(body.email ?? "").toLowerCase(), 220);
  const projectName = clip(String(body.projectName ?? ""), 160);
  const details = clip(String(body.details ?? ""), 3000);
  const websiteUrl = toRequiredUrl(body.websiteUrl);
  const xUrl = toOptionalUrl(body.xUrl);
  const raiseAmountUsdRaw = Number(body.raiseAmountUsd ?? NaN);
  const valuationUsdRaw = Number(body.valuationUsd ?? NaN);
  const raiseAmountUsd =
    Number.isFinite(raiseAmountUsdRaw) && raiseAmountUsdRaw >= 0
      ? Math.floor(raiseAmountUsdRaw)
      : null;
  const valuationUsd =
    Number.isFinite(valuationUsdRaw) && valuationUsdRaw >= 0
      ? Math.floor(valuationUsdRaw)
      : null;
  if (!name || !email || !projectName || !details) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!websiteUrl) {
    return NextResponse.json({ error: "Website is required and must be a valid URL" }, { status: 400 });
  }
  if (raiseAmountUsd === null) {
    return NextResponse.json({ error: "Raising amount is required" }, { status: 400 });
  }
  if (valuationUsd === null) {
    return NextResponse.json({ error: "Valuation is required" }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  await connectToDatabase();

  const created = await PitchSubmission.create({
    name,
    email,
    projectName,
    details,
    websiteUrl,
    xUrl,
    raiseAmountUsd,
    valuationUsd,
    status: "new",
    source: "web_p",
  });

  return NextResponse.json(
    {
      ok: true,
      submissionId: String(created._id),
    },
    { status: 201 }
  );
}
