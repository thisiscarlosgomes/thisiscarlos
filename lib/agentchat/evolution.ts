import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { canonicalizeTopic } from "@/lib/agentchat/topic-utils";
import { tryExportThinkingMarkdown } from "@/lib/agentchat/thinking-export";
import { Belief } from "@/models/Belief";
import { BeliefVersion } from "@/models/BeliefVersion";

type BeliefStatus = "active" | "superseded" | "draft";
type BeliefSourceType = "voice_note" | "call_log" | "manual";
type BeliefEventType =
  | "created"
  | "updated"
  | "approved"
  | "activated"
  | "superseded"
  | "archived"
  | "merged"
  | "conflict_detected";

type BeliefSnapshot = {
  _id: Types.ObjectId;
  topic: string;
  statement: string;
  status: BeliefStatus;
  confidence: number;
  sourceType: BeliefSourceType;
  sourceId: string;
};

export async function appendBeliefVersion(input: {
  beliefId: string | Types.ObjectId;
  eventType: BeliefEventType;
  reason?: string | null;
  previousBeliefId?: string | Types.ObjectId | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const beliefId = String(input.beliefId ?? "").trim();
  if (!Types.ObjectId.isValid(beliefId)) return;

  await connectToDatabase();
  const belief = await Belief.findById(beliefId)
    .select({ topic: 1, statement: 1, status: 1, confidence: 1, sourceType: 1, sourceId: 1 })
    .lean<BeliefSnapshot | null>()
    .exec();
  if (!belief) return;

  const previousBeliefId =
    input.previousBeliefId && Types.ObjectId.isValid(String(input.previousBeliefId))
      ? new Types.ObjectId(String(input.previousBeliefId))
      : null;

  await BeliefVersion.create({
    beliefId: belief._id,
    topic: belief.topic,
    statement: belief.statement,
    status: belief.status,
    confidence: Math.max(0, Math.min(1, Number(belief.confidence ?? 0))),
    sourceType: belief.sourceType,
    sourceId: belief.sourceId,
    eventType: input.eventType,
    reason: input.reason ?? null,
    previousBeliefId,
    metadata: input.metadata ?? null,
  });

  await tryExportThinkingMarkdown();
}

export async function getBeliefEvolution(input?: {
  topic?: string;
  days?: number;
  limit?: number;
}): Promise<
  Array<{
    beliefId: string;
    topic: string;
    eventType: BeliefEventType;
    status: BeliefStatus;
    confidence: number;
    statement: string;
    reason: string | null;
    previousBeliefId: string | null;
    createdAt: string;
  }>
> {
  const rawTopic = String(input?.topic ?? "").trim();
  const topic = rawTopic ? canonicalizeTopic(rawTopic) : "";
  const days = Math.min(90, Math.max(1, Math.floor(Number(input?.days ?? 30) || 30)));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(input?.limit ?? 100) || 100)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  await connectToDatabase();
  const filter: Record<string, unknown> = { createdAt: { $gte: since } };
  if (topic) {
    const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.topic = { $regex: escaped, $options: "i" };
  }

  const rows = await BeliefVersion.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .select({
      beliefId: 1,
      topic: 1,
      eventType: 1,
      status: 1,
      confidence: 1,
      statement: 1,
      reason: 1,
      previousBeliefId: 1,
      createdAt: 1,
    })
    .lean<
      Array<{
        beliefId: Types.ObjectId;
        topic: string;
        eventType: BeliefEventType;
        status: BeliefStatus;
        confidence: number;
        statement: string;
        reason?: string | null;
        previousBeliefId?: Types.ObjectId | null;
        createdAt: Date;
      }>
    >()
    .exec();

  return rows.map((row) => ({
    beliefId: String(row.beliefId),
    topic: row.topic,
    eventType: row.eventType,
    status: row.status,
    confidence: Math.max(0, Math.min(1, Number(row.confidence ?? 0))),
    statement: row.statement,
    reason: row.reason ?? null,
    previousBeliefId: row.previousBeliefId ? String(row.previousBeliefId) : null,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}

export async function getWhyChanged(input: {
  topic?: string;
  days?: number;
}): Promise<{
  topic: string | null;
  changed: boolean;
  previousView: string | null;
  currentView: string | null;
  reason: string | null;
  changedAt: string | null;
}> {
  const topic = String(input.topic ?? "").trim();
  const canonicalTopic = topic ? canonicalizeTopic(topic) : "";
  const events = await getBeliefEvolution({ topic, days: input.days ?? 60, limit: 120 });
  const targetTopic = canonicalTopic || events[0]?.topic || "";
  const topicEvents = events.filter((event) =>
    canonicalTopic
      ? canonicalizeTopic(event.topic) === canonicalTopic
      : event.topic === targetTopic
  );

  const latestActive = topicEvents.find((event) => event.status === "active") ?? null;
  const latestSuperseded = topicEvents.find((event) => event.status === "superseded") ?? null;
  const latestChange =
    topicEvents.find((event) => ["approved", "activated", "superseded", "conflict_detected"].includes(event.eventType)) ??
    topicEvents[0] ??
    null;

  return {
    topic: targetTopic || null,
    changed: Boolean(latestActive && latestSuperseded),
    previousView: latestSuperseded?.statement ?? null,
    currentView: latestActive?.statement ?? null,
    reason: latestChange?.reason ?? null,
    changedAt: latestChange?.createdAt ?? null,
  };
}
