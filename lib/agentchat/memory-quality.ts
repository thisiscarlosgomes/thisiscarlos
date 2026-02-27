import { connectToDatabase } from "@/lib/db";
import { CallLog } from "@/models/CallLog";
import { Belief } from "@/models/Belief";
import { getToolMetricsSummary } from "@/lib/agentchat/tool-metrics";
import { computeBeliefFreshness } from "@/lib/agentchat/thinking";

export async function getMemoryQualityReport(input?: { days?: number }): Promise<{
  windowDays: number;
  generatedAt: string;
  memoryHitRate: number;
  avgMemoryFit: number;
  lowFitRate: number;
  staleBeliefRate: number;
  contradictionRate: number;
  toolLatencyP95Ms: number;
  autoReviewQueue: Array<{ type: "conflict" | "stale"; topic: string; score: number }>;
}> {
  const days = Math.min(30, Math.max(1, Math.floor(Number(input?.days ?? 7) || 7)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  await connectToDatabase();

  const [callRows, activeBeliefs, conflictDrafts] = await Promise.all([
    CallLog.find({
      createdAt: { $gte: since },
      memoryFitScore: { $ne: null },
    })
      .select({ memoryFitScore: 1 })
      .lean<Array<{ memoryFitScore?: number | null }>>()
      .exec(),
    Belief.find({ status: "active" })
      .select({ topic: 1, confidence: 1, updatedAt: 1, effectiveFrom: 1, sourceType: 1, evidenceCount: 1 })
      .lean<
        Array<{
          topic: string;
          confidence: number;
          updatedAt: Date;
          effectiveFrom: Date;
          sourceType: "voice_note" | "call_log" | "manual";
          evidenceCount?: number;
        }>
      >()
      .exec(),
    Belief.find({ status: "draft", conflict: true })
      .select({ topic: 1, confidence: 1, updatedAt: 1, effectiveFrom: 1, sourceType: 1, evidenceCount: 1 })
      .lean<
        Array<{
          topic: string;
          confidence: number;
          updatedAt: Date;
          effectiveFrom: Date;
          sourceType: "voice_note" | "call_log" | "manual";
          evidenceCount?: number;
        }>
      >()
      .exec(),
  ]);

  const fitScores = callRows
    .map((row) => Number(row.memoryFitScore ?? NaN))
    .filter((score) => Number.isFinite(score))
    .map((score) => Math.max(0, Math.min(1, score)));

  const avgMemoryFit =
    fitScores.length > 0 ? fitScores.reduce((sum, score) => sum + score, 0) / fitScores.length : 0;
  const memoryHitRate =
    fitScores.length > 0 ? fitScores.filter((score) => score >= 0.55).length / fitScores.length : 0;
  const lowFitRate =
    fitScores.length > 0 ? fitScores.filter((score) => score < 0.35).length / fitScores.length : 0;

  const staleBeliefs = activeBeliefs.filter((belief) => {
    const freshness = computeBeliefFreshness({
      updatedAt: belief.updatedAt,
      effectiveFrom: belief.effectiveFrom,
      evidenceCount: belief.evidenceCount ?? 0,
      sourceType: belief.sourceType,
    });
    return freshness < 0.4;
  });
  const staleBeliefRate =
    activeBeliefs.length > 0 ? staleBeliefs.length / activeBeliefs.length : 0;
  const contradictionRate =
    activeBeliefs.length > 0 ? conflictDrafts.length / activeBeliefs.length : 0;

  const toolSummary = await getToolMetricsSummary({
    tools: ["get_user_name", "get_current_thinking", "get_voice_note_context"],
    hours: days * 24,
  });
  const toolLatencyP95Ms =
    toolSummary.tools.length > 0
      ? Math.max(...toolSummary.tools.map((tool) => Number(tool.p95LatencyMs ?? 0)))
      : 0;

  const staleQueue = staleBeliefs.slice(0, 5).map((belief) => ({
    type: "stale" as const,
    topic: belief.topic,
    score: Number(
      computeBeliefFreshness({
        updatedAt: belief.updatedAt,
        effectiveFrom: belief.effectiveFrom,
        evidenceCount: belief.evidenceCount ?? 0,
        sourceType: belief.sourceType,
      }).toFixed(2)
    ),
  }));

  const conflictQueue = conflictDrafts.slice(0, 5).map((belief) => ({
    type: "conflict" as const,
    topic: belief.topic,
    score: Math.max(0, Math.min(1, Number(belief.confidence ?? 0))),
  }));

  return {
    windowDays: days,
    generatedAt: new Date().toISOString(),
    memoryHitRate,
    avgMemoryFit,
    lowFitRate,
    staleBeliefRate,
    contradictionRate,
    toolLatencyP95Ms,
    autoReviewQueue: [...conflictQueue, ...staleQueue].slice(0, 8),
  };
}
