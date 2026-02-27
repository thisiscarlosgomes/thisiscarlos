import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { OPENAI_MODEL } from "@/lib/agentchat/config";
import { appendBeliefVersion } from "@/lib/agentchat/evolution";
import { normalizeTopic, pickCanonicalTopic } from "@/lib/agentchat/topic-utils";
import { Belief } from "@/models/Belief";

type ReflectionSourceType = "voice_note" | "call_log" | "manual";

export type ReflectionSource = {
  sourceType: ReflectionSourceType;
  sourceId: string;
  text: string;
  topicHint?: string | null;
  createdAt?: Date;
};

type BeliefCandidate = {
  topic: string;
  statement: string;
  confidence: number;
};

function clip(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function normalizeStatement(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferChangeReason(sourceType: ReflectionSourceType): string {
  if (sourceType === "voice_note") return "new voice note suggests a changed view";
  if (sourceType === "call_log") return "recent call discussion suggests a changed view";
  return "new source suggests a changed view";
}

function countUniqueEvidence(
  sourceRefs: Array<{ sourceType: ReflectionSourceType; sourceId: string }> = []
): number {
  const keys = new Set<string>();
  for (const ref of sourceRefs) {
    keys.add(`${ref.sourceType}:${ref.sourceId}`);
  }
  return keys.size;
}

function calibrateConfidence(raw: number, evidenceCount: number): number {
  const safeRaw = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.6;
  // Keep first-pass beliefs conservative; allow confidence to rise only with repeated evidence.
  const cap =
    evidenceCount >= 5 ? 0.9 : evidenceCount >= 3 ? 0.82 : evidenceCount >= 2 ? 0.75 : 0.68;
  return Math.max(0.45, Math.min(cap, safeRaw));
}

function fallbackCandidate(source: ReflectionSource): BeliefCandidate {
  const hint = clip(source.topicHint ?? "", 60);
  const firstSentence = clip(source.text.split(/[.!?]/)[0] ?? source.text, 220);
  return {
    topic: normalizeTopic(hint || "general"),
    statement: clip(firstSentence || "recent update captured", 300),
    confidence: 0.55,
  };
}

function parseCandidateJson(raw: string): BeliefCandidate | null {
  try {
    const parsed = JSON.parse(raw) as {
      topic?: unknown;
      statement?: unknown;
      confidence?: unknown;
    };
    const topic = normalizeTopic(String(parsed.topic ?? ""));
    const statement = clip(String(parsed.statement ?? "").trim(), 300);
    const confidenceRaw = Number(parsed.confidence ?? 0.6);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0.6;
    if (!statement) return null;
    return { topic, statement, confidence };
  } catch {
    return null;
  }
}

async function inferBeliefCandidate(source: ReflectionSource): Promise<BeliefCandidate> {
  const fallback = fallbackCandidate(source);
  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const { text } = await generateText({
      model: openai(OPENAI_MODEL),
      system: [
        "You extract one current belief update from personal notes/calls.",
        "Return strict JSON only: {\"topic\":\"...\",\"statement\":\"...\",\"confidence\":0.0-1.0}",
        "topic should be 1-3 lowercase words.",
        "statement should be one concise sentence under 25 words.",
      ].join(" "),
      prompt: [
        `source_type: ${source.sourceType}`,
        source.topicHint ? `topic_hint: ${clip(source.topicHint, 80)}` : "",
        `text: ${clip(source.text, 3000)}`,
      ]
        .filter(Boolean)
        .join("\n"),
      temperature: 0.2,
      maxOutputTokens: 120,
    });

    return parseCandidateJson(text) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function reflectFromSource(source: ReflectionSource): Promise<void> {
  const sourceId = source.sourceId.trim();
  const text = clip(source.text, 4000);
  if (!sourceId || !text) return;

  const candidate = await inferBeliefCandidate({
    ...source,
    sourceId,
    text,
  });

  await connectToDatabase();
  const now = source.createdAt ?? new Date();

  const existingTopics = await Belief.distinct("topic", {
    status: { $in: ["active", "draft"] },
  }).exec();
  const canonicalTopic = pickCanonicalTopic({
    candidate: candidate.topic,
    existingTopics: existingTopics.map((value) => normalizeTopic(String(value ?? ""))),
  });
  candidate.topic = canonicalTopic;

  const existing = await Belief.findOne({
    topic: candidate.topic,
    status: "active",
  })
    .sort({ effectiveFrom: -1 })
    .lean<{
      _id: Types.ObjectId;
      statement: string;
      confidence: number;
      sourceRefs?: Array<{ sourceType: ReflectionSourceType; sourceId: string; createdAt: Date }>;
    } | null>()
    .exec();

  const priorEvidenceCount = countUniqueEvidence(existing?.sourceRefs);
  const nextEvidenceCount = priorEvidenceCount + 1;
  const calibratedConfidence = calibrateConfidence(candidate.confidence, nextEvidenceCount);

  if (!existing) {
    const created = await Belief.create({
      topic: candidate.topic,
      statement: candidate.statement,
      confidence: calibrateConfidence(candidate.confidence, 1),
      status: "active",
      sourceType: source.sourceType,
      sourceId,
      sourceRefs: [{ sourceType: source.sourceType, sourceId, createdAt: now }],
      effectiveFrom: now,
      effectiveTo: null,
      supersedesBeliefId: null,
      conflict: false,
      conflictsWithBeliefId: null,
      changeReason: null,
    });
    await appendBeliefVersion({
      beliefId: created._id,
      eventType: "created",
      reason: "new belief extracted from source",
    });
    return;
  }

  const sameBelief =
    normalizeStatement(existing.statement) === normalizeStatement(candidate.statement);

  if (sameBelief) {
    const boostedConfidence = calibrateConfidence(
      Math.max(existing.confidence ?? 0, candidate.confidence),
      nextEvidenceCount
    );
    await Belief.updateOne(
      { _id: existing._id },
      {
        $set: {
          confidence: boostedConfidence,
          sourceType: source.sourceType,
          sourceId,
          updatedAt: new Date(),
          conflict: false,
          conflictsWithBeliefId: null,
          changeReason: null,
        },
        $push: {
          sourceRefs: {
            sourceType: source.sourceType,
            sourceId,
            createdAt: now,
          },
        },
      }
    ).exec();
    await appendBeliefVersion({
      beliefId: existing._id,
      eventType: "updated",
      reason: "same belief reinforced by new source",
    });
    return;
  }

  const existingDraft = await Belief.findOne({
    topic: candidate.topic,
    status: "draft",
  })
    .sort({ updatedAt: -1 })
    .lean<{
      _id: Types.ObjectId;
      statement: string;
      sourceRefs?: Array<{ sourceType: ReflectionSourceType; sourceId: string; createdAt: Date }>;
    } | null>()
    .exec();

  if (existingDraft && normalizeStatement(existingDraft.statement) === normalizeStatement(candidate.statement)) {
    await Belief.updateOne(
      { _id: existingDraft._id },
      {
        $set: {
          confidence: calibratedConfidence,
          sourceType: source.sourceType,
          sourceId,
          updatedAt: now,
          conflict: true,
          conflictsWithBeliefId: existing._id,
          changeReason: inferChangeReason(source.sourceType),
        },
        $push: {
          sourceRefs: {
            sourceType: source.sourceType,
            sourceId,
            createdAt: now,
          },
        },
      }
    ).exec();
    await appendBeliefVersion({
      beliefId: existingDraft._id,
      eventType: "conflict_detected",
      reason: inferChangeReason(source.sourceType),
      previousBeliefId: existing._id,
    });
    return;
  }

  const createdDraft = await Belief.create({
    topic: candidate.topic,
    statement: candidate.statement,
    confidence: calibratedConfidence,
    status: "draft",
    sourceType: source.sourceType,
    sourceId,
    sourceRefs: [{ sourceType: source.sourceType, sourceId, createdAt: now }],
    effectiveFrom: now,
    effectiveTo: null,
    supersedesBeliefId: existing._id,
    conflict: true,
    conflictsWithBeliefId: existing._id,
    changeReason: inferChangeReason(source.sourceType),
  });
  await appendBeliefVersion({
    beliefId: createdDraft._id,
    eventType: "conflict_detected",
    reason: inferChangeReason(source.sourceType),
    previousBeliefId: existing._id,
  });
}
