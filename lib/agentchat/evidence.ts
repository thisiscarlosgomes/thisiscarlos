import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { OPENAI_MODEL } from "@/lib/agentchat/config";
import { Belief } from "@/models/Belief";
import { Evidence } from "@/models/Evidence";

export type EvidenceStance = "supports" | "challenges" | "neutral";

type IngestEvidenceInput = {
  url: string;
  beliefId?: string | null;
};

type IngestEvidenceResult = {
  id: string;
  beliefId: string | null;
  url: string;
  normalizedUrl: string;
  domain: string;
  title: string | null;
  summary: string;
  excerpt: string;
  stance: EvidenceStance;
  qualityScore: number;
  fetchedAt: string;
};

function clip(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function readTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const title = stripHtml(match[1] ?? "");
  return title ? clip(title, 280) : null;
}

function normalizeUrl(raw: string): { url: URL; normalized: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.hash = "";
    return { url: parsed, normalized: parsed.toString() };
  } catch {
    return null;
  }
}

async function fetchEvidenceContent(url: string): Promise<{
  title: string | null;
  text: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "carlos-ai-evidence-bot/1.0",
        Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`Could not fetch link (${response.status})`);
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const raw = await response.text();
    if (!raw.trim()) {
      throw new Error("Empty response body");
    }

    if (contentType.includes("application/json")) {
      const parsed = JSON.parse(raw) as unknown;
      const normalized = clip(JSON.stringify(parsed), 5000);
      return { title: null, text: normalized };
    }

    if (contentType.includes("text/plain")) {
      return { title: null, text: clip(raw, 5000) };
    }

    const title = readTitle(raw);
    const text = clip(stripHtml(raw), 5000);
    if (!text) {
      throw new Error("No readable content found");
    }
    return { title, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function summarizeEvidence(title: string | null, text: string): Promise<string> {
  const fallback = clip([title, text].filter(Boolean).join(". "), 220);
  if (!process.env.OPENAI_API_KEY) return fallback || "external source captured";
  try {
    const { text: result } = await generateText({
      model: openai(OPENAI_MODEL),
      system: "Summarize source content into one short sentence. Keep it factual and concrete.",
      prompt: [
        "Return exactly one sentence under 28 words.",
        title ? `Title: ${clip(title, 240)}` : "",
        `Body: ${clip(text, 2500)}`,
      ]
        .filter(Boolean)
        .join("\n"),
      maxOutputTokens: 80,
      temperature: 0.1,
    });
    return clip(result || fallback || "external source captured", 260);
  } catch {
    return fallback || "external source captured";
  }
}

async function inferStance(beliefStatement: string, evidenceSummary: string): Promise<EvidenceStance> {
  const statement = beliefStatement.trim();
  if (!statement) return "neutral";
  if (!process.env.OPENAI_API_KEY) {
    const normalized = evidenceSummary.toLowerCase();
    if (/\b(not|false|wrong|declin|drop|risk)\b/.test(normalized)) return "challenges";
    if (/\b(yes|support|confirm|increase|grow|improv)\b/.test(normalized)) return "supports";
    return "neutral";
  }

  try {
    const { text } = await generateText({
      model: openai(OPENAI_MODEL),
      system:
        "Classify if evidence supports, challenges, or is neutral to the belief. Return only one token: supports|challenges|neutral.",
      prompt: [`belief: ${clip(statement, 260)}`, `evidence: ${clip(evidenceSummary, 400)}`].join("\n"),
      maxOutputTokens: 8,
      temperature: 0,
    });
    const normalized = text.trim().toLowerCase();
    if (normalized.includes("support")) return "supports";
    if (normalized.includes("challenge")) return "challenges";
    return "neutral";
  } catch {
    return "neutral";
  }
}

function estimateQualityScore(text: string, domain: string): number {
  const base = Math.min(1, Math.max(0.45, text.length / 2000));
  const trustedBump = /(arxiv\.org|openai\.com|docs\.|github\.com|nature\.com|science\.org)/i.test(domain)
    ? 0.08
    : 0;
  return Math.max(0.35, Math.min(0.95, base + trustedBump));
}

export async function recalculateBeliefConfidenceFromEvidence(
  beliefId: Types.ObjectId | string
): Promise<void> {
  const objectId =
    typeof beliefId === "string" ? (Types.ObjectId.isValid(beliefId) ? new Types.ObjectId(beliefId) : null) : beliefId;
  if (!objectId) return;

  await connectToDatabase();
  const [belief, evidenceRows] = await Promise.all([
    Belief.findById(objectId)
      .select({ confidence: 1 })
      .lean<{ confidence: number } | null>()
      .exec(),
    Evidence.find({ beliefId: objectId })
      .select({ stance: 1, qualityScore: 1 })
      .lean<Array<{ stance: EvidenceStance; qualityScore: number }>>()
      .exec(),
  ]);

  if (!belief) return;

  const evidenceCount = evidenceRows.length;
  const supportScore = evidenceRows
    .filter((row) => row.stance === "supports")
    .reduce((sum, row) => sum + Math.max(0, Math.min(1, Number(row.qualityScore) || 0)), 0);
  const challengeScore = evidenceRows
    .filter((row) => row.stance === "challenges")
    .reduce((sum, row) => sum + Math.max(0, Math.min(1, Number(row.qualityScore) || 0)), 0);

  const net = supportScore - challengeScore;
  const baseline = Math.max(0.45, Math.min(0.82, Number(belief.confidence) || 0.6));
  const adjusted = Math.max(0.3, Math.min(0.93, baseline + net * 0.06));
  const confidenceReason =
    evidenceCount <= 0
      ? "No external evidence linked yet."
      : supportScore > challengeScore
      ? "External links mostly support this belief."
      : challengeScore > supportScore
      ? "External links raise challenges to this belief."
      : "External links are mixed or neutral.";

  await Belief.updateOne(
    { _id: objectId },
    {
      $set: {
        confidence: adjusted,
        evidenceCount,
        supportScore: Number(supportScore.toFixed(3)),
        challengeScore: Number(challengeScore.toFixed(3)),
        confidenceReason,
      },
    }
  ).exec();
}

export async function ingestEvidence(input: IngestEvidenceInput): Promise<IngestEvidenceResult> {
  const parsed = normalizeUrl(input.url);
  if (!parsed) {
    throw new Error("Invalid URL");
  }

  const beliefObjectId =
    input.beliefId && Types.ObjectId.isValid(input.beliefId) ? new Types.ObjectId(input.beliefId) : null;

  await connectToDatabase();

  let beliefStatement = "";
  if (beliefObjectId) {
    const belief = await Belief.findById(beliefObjectId)
      .select({ statement: 1 })
      .lean<{ statement: string } | null>()
      .exec();
    if (!belief) throw new Error("Belief not found");
    beliefStatement = belief.statement;
  }

  const fetched = await fetchEvidenceContent(parsed.normalized);
  const excerpt = clip(fetched.text, 1000);
  const summary = await summarizeEvidence(fetched.title, fetched.text);
  const stance = beliefStatement ? await inferStance(beliefStatement, summary) : "neutral";
  const qualityScore = estimateQualityScore(fetched.text, parsed.url.hostname);

  const created = await Evidence.create({
    beliefId: beliefObjectId,
    url: parsed.url.toString(),
    normalizedUrl: parsed.normalized,
    domain: parsed.url.hostname,
    title: fetched.title,
    summary,
    excerpt,
    stance,
    qualityScore,
    fetchedAt: new Date(),
  });

  if (beliefObjectId) {
    await recalculateBeliefConfidenceFromEvidence(beliefObjectId);
  }

  return {
    id: String(created._id),
    beliefId: created.beliefId ? String(created.beliefId) : null,
    url: created.url,
    normalizedUrl: created.normalizedUrl,
    domain: created.domain,
    title: created.title,
    summary: created.summary,
    excerpt: created.excerpt,
    stance: created.stance,
    qualityScore: created.qualityScore,
    fetchedAt: created.fetchedAt.toISOString(),
  };
}
