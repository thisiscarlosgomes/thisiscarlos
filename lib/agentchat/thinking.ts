import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { canonicalizeTopic } from "@/lib/agentchat/topic-utils";
import { Belief } from "@/models/Belief";

export type TimelineEntry = {
  id: string;
  topic: string;
  statement: string;
  status: "active" | "superseded" | "draft";
  confidence: number;
  conflict: boolean;
  conflictsWithBeliefId: string | null;
  supersedesBeliefId: string | null;
  changeReason: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
};

export type RankedBelief = {
  id: string;
  topic: string;
  statement: string;
  confidence: number;
  freshnessScore: number;
  retrievalScore: number;
  confidenceReason: string | null;
  effectiveFrom: string;
  updatedAt: string;
  sourceType: "voice_note" | "call_log" | "manual";
  evidenceCount: number;
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function scoreOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  const matches = a.filter((token) => bSet.has(token)).length;
  return Math.max(0, Math.min(1, matches / Math.max(1, a.length)));
}

export function computeBeliefFreshness(input: {
  updatedAt: Date;
  effectiveFrom: Date;
  evidenceCount?: number;
  sourceType?: "voice_note" | "call_log" | "manual";
}): number {
  const nowMs = Date.now();
  const updatedAtMs = new Date(input.updatedAt).getTime();
  const effectiveMs = new Date(input.effectiveFrom).getTime();
  const refMs = Number.isFinite(updatedAtMs) ? updatedAtMs : effectiveMs;
  const ageDays = Math.max(0, (nowMs - refMs) / (24 * 60 * 60 * 1000));

  const ageScore = Math.exp(-ageDays / 14); // ~0.5 at ~10 days
  const evidenceCount = Math.max(0, Number(input.evidenceCount ?? 0));
  const evidenceBoost = Math.min(0.25, evidenceCount * 0.05);
  const sourceBoost = input.sourceType === "voice_note" ? 0.05 : input.sourceType === "manual" ? 0.03 : 0;

  return Math.max(0.05, Math.min(1, ageScore + evidenceBoost + sourceBoost));
}

export async function getBestContext(input: {
  topic?: string;
  limit?: number;
}): Promise<{ topic: string | null; beliefs: RankedBelief[] }> {
  const requestedLimit = Number(input.limit ?? 2);
  const limit = Math.min(5, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 2));
  const rawTopic = String(input.topic ?? "").trim();
  const topic = rawTopic ? canonicalizeTopic(rawTopic) : "";
  const topicTokens = tokenize(topic);

  await connectToDatabase();
  const rows = await Belief.find({
    status: "active",
    conflict: { $ne: true },
  })
    .sort({ updatedAt: -1 })
    .limit(50)
    .select({
      topic: 1,
      statement: 1,
      confidence: 1,
      confidenceReason: 1,
      effectiveFrom: 1,
      updatedAt: 1,
      sourceType: 1,
      sourceRefs: 1,
      evidenceCount: 1,
    })
    .lean<
      Array<{
        _id: Types.ObjectId;
        topic: string;
        statement: string;
        confidence: number;
        confidenceReason?: string | null;
        effectiveFrom: Date;
        updatedAt: Date;
        sourceType: "voice_note" | "call_log" | "manual";
        sourceRefs?: Array<{ createdAt?: Date }>;
        evidenceCount?: number;
      }>
    >()
    .exec();

  const ranked = rows
    .map((row) => {
      const freshnessScore = computeBeliefFreshness({
        updatedAt: row.updatedAt,
        effectiveFrom: row.effectiveFrom,
        evidenceCount: Math.max(Number(row.evidenceCount ?? 0), Math.max(1, row.sourceRefs?.length ?? 1)),
        sourceType: row.sourceType,
      });
      const textTokens = tokenize(`${row.topic} ${row.statement}`);
      const overlap = topicTokens.length > 0 ? scoreOverlap(topicTokens, textTokens) : 0.5;
      const confidence = Math.max(0, Math.min(1, Number(row.confidence ?? 0)));
      const retrievalScore = topicTokens.length > 0
        ? overlap * 0.55 + freshnessScore * 0.25 + confidence * 0.2
        : freshnessScore * 0.55 + confidence * 0.45;

      return {
        id: String(row._id),
        topic: row.topic,
        statement: row.statement,
        confidence,
        freshnessScore,
        retrievalScore,
        confidenceReason: row.confidenceReason ?? null,
        effectiveFrom: new Date(row.effectiveFrom).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
        sourceType: row.sourceType ?? "manual",
        evidenceCount: Math.max(Number(row.evidenceCount ?? 0), Math.max(1, row.sourceRefs?.length ?? 1)),
      };
    })
    .sort((a, b) => b.retrievalScore - a.retrievalScore)
    .slice(0, limit);

  return {
    topic: topic || null,
    beliefs: ranked,
  };
}

export async function getThinkingTimeline(input: {
  topic?: string;
  limit?: number;
}): Promise<TimelineEntry[]> {
  const requestedLimit = Number(input.limit ?? 50);
  const limit = Math.min(200, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50));
  const rawTopic = String(input.topic ?? "").trim();
  const topic = rawTopic ? canonicalizeTopic(rawTopic) : "";

  await connectToDatabase();
  const filter: Record<string, unknown> = {};
  if (topic) {
    const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.topic = { $regex: escaped, $options: "i" };
  }

  const rows = await Belief.find(filter)
    .sort({ effectiveFrom: 1, updatedAt: 1 })
    .limit(limit)
    .select({
      topic: 1,
      statement: 1,
      status: 1,
      confidence: 1,
      conflict: 1,
      conflictsWithBeliefId: 1,
      supersedesBeliefId: 1,
      changeReason: 1,
      effectiveFrom: 1,
      effectiveTo: 1,
      updatedAt: 1,
    })
    .lean<
      Array<{
        _id: Types.ObjectId;
        topic: string;
        statement: string;
        status: "active" | "superseded" | "draft";
        confidence: number;
        conflict?: boolean;
        conflictsWithBeliefId?: Types.ObjectId | null;
        supersedesBeliefId?: Types.ObjectId | null;
        changeReason?: string | null;
        effectiveFrom: Date;
        effectiveTo: Date | null;
        updatedAt: Date;
      }>
    >()
    .exec();

  return rows.map((row) => ({
    id: String(row._id),
    topic: row.topic,
    statement: row.statement,
    status: row.status,
    confidence: Math.max(0, Math.min(1, Number(row.confidence ?? 0))),
    conflict: Boolean(row.conflict),
    conflictsWithBeliefId: row.conflictsWithBeliefId ? String(row.conflictsWithBeliefId) : null,
    supersedesBeliefId: row.supersedesBeliefId ? String(row.supersedesBeliefId) : null,
    changeReason: row.changeReason ?? null,
    effectiveFrom: new Date(row.effectiveFrom).toISOString(),
    effectiveTo: row.effectiveTo ? new Date(row.effectiveTo).toISOString() : null,
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
}

export async function getThinkingChanges(input: {
  topic?: string;
  days?: number;
  limit?: number;
}): Promise<
  Array<{
    topic: string;
    currentView: string | null;
    previousView: string | null;
    changedAt: string;
    reason: string | null;
    conflictOpen: boolean;
  }>
> {
  const rawTopic = String(input.topic ?? "").trim();
  const topic = rawTopic ? canonicalizeTopic(rawTopic) : "";
  const days = Math.min(30, Math.max(1, Math.floor(Number(input.days ?? 7) || 7)));
  const limit = Math.min(20, Math.max(1, Math.floor(Number(input.limit ?? 5) || 5)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  await connectToDatabase();

  const topicFilter = topic
    ? { topic: { $regex: topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }
    : {};

  const rows = await Belief.find({
    ...topicFilter,
    updatedAt: { $gte: since },
  })
    .sort({ updatedAt: -1 })
    .select({
      topic: 1,
      statement: 1,
      status: 1,
      conflict: 1,
      changeReason: 1,
      updatedAt: 1,
    })
    .lean<
      Array<{
        _id: Types.ObjectId;
        topic: string;
        statement: string;
        status: "active" | "superseded" | "draft";
        conflict?: boolean;
        changeReason?: string | null;
        updatedAt: Date;
      }>
    >()
    .exec();

  const topics = [...new Set(rows.map((row) => row.topic))].slice(0, limit);
  const results: Array<{
    topic: string;
    currentView: string | null;
    previousView: string | null;
    changedAt: string;
    reason: string | null;
    conflictOpen: boolean;
  }> = [];

  for (const topicName of topics) {
    const byTopic = rows.filter((row) => row.topic === topicName).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const current = byTopic.find((row) => row.status === "active") ?? null;
    const previous = byTopic.find((row) => row.status === "superseded") ?? null;
    const latest = byTopic[0];
    if (!latest) continue;

    results.push({
      topic: topicName,
      currentView: current?.statement ?? null,
      previousView: previous?.statement ?? null,
      changedAt: new Date(latest.updatedAt).toISOString(),
      reason: latest.changeReason ?? null,
      conflictOpen: byTopic.some((row) => row.status === "draft" && row.conflict),
    });
  }

  return results;
}

export async function getWeeklyThinkingDigest(): Promise<{
  windowDays: number;
  generatedAt: string;
  changedTopics: number;
  openConflicts: number;
  promotedBeliefs: number;
  items: Array<{
    topic: string;
    currentView: string | null;
    previousView: string | null;
    conflictOpen: boolean;
    changedAt: string;
  }>;
}> {
  const items = await getThinkingChanges({ days: 7, limit: 20 });
  const changedTopics = items.length;
  const openConflicts = items.filter((item) => item.conflictOpen).length;
  const promotedBeliefs = items.filter((item) => Boolean(item.currentView && item.previousView)).length;

  return {
    windowDays: 7,
    generatedAt: new Date().toISOString(),
    changedTopics,
    openConflicts,
    promotedBeliefs,
    items,
  };
}

export async function evaluateCallMemoryFit(input: {
  summary: string;
  topic?: string | null;
}): Promise<{
  fitScore: number;
  mismatchReason: string | null;
  bestBeliefId: string | null;
}> {
  const summary = String(input.summary ?? "").trim();
  const rawTopic = String(input.topic ?? "").trim();
  const topic = rawTopic ? canonicalizeTopic(rawTopic) : "";
  const query = topic || summary;
  const bestContext = await getBestContext({ topic: query, limit: 1 });
  const best = bestContext.beliefs[0];
  if (!best) {
    return {
      fitScore: 0,
      mismatchReason: "no active belief available",
      bestBeliefId: null,
    };
  }

  const summaryTokens = tokenize(summary);
  const beliefTokens = tokenize(`${best.topic} ${best.statement}`);
  const semanticOverlap = scoreOverlap(summaryTokens, beliefTokens);
  const fitScore = Math.max(0, Math.min(1, semanticOverlap * 0.65 + best.freshnessScore * 0.2 + best.confidence * 0.15));

  let mismatchReason: string | null = null;
  if (fitScore < 0.35) {
    mismatchReason =
      best.freshnessScore < 0.35
        ? "best matching belief is stale"
        : "active beliefs do not match latest call direction";
  }

  return {
    fitScore,
    mismatchReason,
    bestBeliefId: best.id,
  };
}
