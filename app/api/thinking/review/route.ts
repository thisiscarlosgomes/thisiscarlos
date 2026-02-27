import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { appendBeliefVersion } from "@/lib/agentchat/evolution";
import { isOwnerRequest } from "@/lib/voice-notes/auth";
import { Belief } from "@/models/Belief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReviewAction =
  | "approve_draft"
  | "supersede_active"
  | "merge_into_active"
  | "archive_belief"
  | "activate_belief";

function parseStatuses(raw: string | null): Array<"active" | "superseded" | "draft"> {
  const allowed = new Set(["active", "superseded", "draft"]);
  const values = (raw ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is "active" | "superseded" | "draft" => allowed.has(value));
  return values.length > 0 ? values : ["active", "draft", "superseded"];
}

function toObjectId(value: string): Types.ObjectId | null {
  const trimmed = value.trim();
  if (!Types.ObjectId.isValid(trimmed)) return null;
  return new Types.ObjectId(trimmed);
}

function dedupeSourceRefs(
  refs: Array<{ sourceType: "voice_note" | "call_log" | "manual"; sourceId: string; createdAt?: Date }>
): Array<{ sourceType: "voice_note" | "call_log" | "manual"; sourceId: string; createdAt: Date }> {
  const deduped = new Map<string, { sourceType: "voice_note" | "call_log" | "manual"; sourceId: string; createdAt: Date }>();
  for (const ref of refs) {
    const sourceId = String(ref.sourceId ?? "").trim();
    if (!sourceId) continue;
    const key = `${ref.sourceType}:${sourceId}`;
    const createdAt = ref.createdAt ? new Date(ref.createdAt) : new Date();
    const previous = deduped.get(key);
    if (!previous || createdAt.getTime() > previous.createdAt.getTime()) {
      deduped.set(key, {
        sourceType: ref.sourceType,
        sourceId,
        createdAt,
      });
    }
  }
  return [...deduped.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function calibrateFromEvidence(confidence: number, evidenceCount: number): number {
  const safe = Math.max(0, Math.min(1, Number(confidence) || 0.6));
  const cap =
    evidenceCount >= 5 ? 0.9 : evidenceCount >= 3 ? 0.82 : evidenceCount >= 2 ? 0.75 : 0.68;
  return Math.max(0.45, Math.min(cap, safe));
}

export async function GET(req: Request) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const statuses = parseStatuses(url.searchParams.get("status"));
  const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
  const limit = Math.min(200, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50));

  await connectToDatabase();
  const beliefs = await Belief.find({ status: { $in: statuses } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select({
      topic: 1,
      statement: 1,
      confidence: 1,
      confidenceReason: 1,
      status: 1,
      sourceType: 1,
      sourceId: 1,
      sourceRefs: 1,
      evidenceCount: 1,
      supportScore: 1,
      challengeScore: 1,
      conflict: 1,
      conflictsWithBeliefId: 1,
      changeReason: 1,
      effectiveFrom: 1,
      effectiveTo: 1,
      supersedesBeliefId: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .lean<
      Array<{
        _id: Types.ObjectId;
        topic: string;
        statement: string;
        confidence: number;
        confidenceReason?: string | null;
        status: "active" | "superseded" | "draft";
        sourceType: "voice_note" | "call_log" | "manual";
        sourceId: string;
        sourceRefs?: Array<{
          sourceType: "voice_note" | "call_log" | "manual";
          sourceId: string;
          createdAt: Date;
        }>;
        effectiveFrom: Date;
        effectiveTo: Date | null;
        supersedesBeliefId: Types.ObjectId | null;
        evidenceCount?: number;
        supportScore?: number;
        challengeScore?: number;
        conflict?: boolean;
        conflictsWithBeliefId?: Types.ObjectId | null;
        changeReason?: string | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >()
    .exec();

  return NextResponse.json({
    beliefs: beliefs.map((belief) => ({
      id: String(belief._id),
      topic: belief.topic,
      statement: belief.statement,
      confidence: belief.confidence,
      confidenceReason: belief.confidenceReason ?? null,
      status: belief.status,
      sourceType: belief.sourceType,
      sourceId: belief.sourceId,
      sourceEvidenceCount: Math.max(1, belief.sourceRefs?.length ?? 1),
      externalEvidenceCount: Math.max(0, Number(belief.evidenceCount ?? 0)),
      evidenceCount: Math.max(0, Number(belief.evidenceCount ?? 0)),
      supportScore: Number(belief.supportScore ?? 0),
      challengeScore: Number(belief.challengeScore ?? 0),
      conflict: Boolean(belief.conflict),
      conflictsWithBeliefId: belief.conflictsWithBeliefId ? String(belief.conflictsWithBeliefId) : null,
      changeReason: belief.changeReason ?? null,
      effectiveFrom: new Date(belief.effectiveFrom).toISOString(),
      effectiveTo: belief.effectiveTo ? new Date(belief.effectiveTo).toISOString() : null,
      supersedesBeliefId: belief.supersedesBeliefId ? String(belief.supersedesBeliefId) : null,
      createdAt: new Date(belief.createdAt).toISOString(),
      updatedAt: new Date(belief.updatedAt).toISOString(),
    })),
  });
}

type ReviewBody = {
  action?: ReviewAction;
  beliefId?: string;
  targetBeliefId?: string;
};

export async function POST(req: Request) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ReviewBody;
  try {
    body = (await req.json()) as ReviewBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "").trim() as ReviewAction;
  const beliefObjectId = toObjectId(String(body.beliefId ?? ""));

  if (!action || !beliefObjectId) {
    return NextResponse.json({ error: "Missing action or beliefId" }, { status: 400 });
  }

  await connectToDatabase();
  const belief = await Belief.findById(beliefObjectId)
    .lean<{
      _id: Types.ObjectId;
      topic: string;
      statement: string;
      confidence: number;
      status: "active" | "superseded" | "draft";
      sourceType: "voice_note" | "call_log" | "manual";
      sourceId: string;
      sourceRefs?: Array<{ sourceType: "voice_note" | "call_log" | "manual"; sourceId: string; createdAt: Date }>;
    } | null>()
    .exec();

  if (!belief) {
    return NextResponse.json({ error: "Belief not found" }, { status: 404 });
  }

  const now = new Date();

  if (action === "approve_draft") {
    if (belief.status !== "draft") {
      return NextResponse.json({ error: "Belief is not a draft" }, { status: 400 });
    }

    const activeBefore = await Belief.find({
      topic: belief.topic,
      status: "active",
      _id: { $ne: belief._id },
    })
      .select({ _id: 1 })
      .lean<Array<{ _id: Types.ObjectId }>>()
      .exec();

    await Belief.updateMany(
      { topic: belief.topic, status: "active", _id: { $ne: belief._id } },
      { $set: { status: "superseded", effectiveTo: now } }
    ).exec();

    await Belief.updateOne(
      { _id: belief._id },
      {
        $set: {
          status: "active",
          effectiveFrom: now,
          effectiveTo: null,
          conflict: false,
          conflictsWithBeliefId: null,
          changeReason: null,
        },
      }
    ).exec();
    for (const row of activeBefore) {
      await appendBeliefVersion({
        beliefId: row._id,
        eventType: "superseded",
        reason: "superseded by draft approval",
        previousBeliefId: belief._id,
      });
    }
    await appendBeliefVersion({
      beliefId: belief._id,
      eventType: "approved",
      reason: "draft approved to active",
    });

    return NextResponse.json({ ok: true, action });
  }

  if (action === "activate_belief") {
    const activeBefore = await Belief.find({
      topic: belief.topic,
      status: "active",
      _id: { $ne: belief._id },
    })
      .select({ _id: 1 })
      .lean<Array<{ _id: Types.ObjectId }>>()
      .exec();

    await Belief.updateMany(
      { topic: belief.topic, status: "active", _id: { $ne: belief._id } },
      { $set: { status: "superseded", effectiveTo: now } }
    ).exec();

    await Belief.updateOne(
      { _id: belief._id },
      {
        $set: {
          status: "active",
          effectiveFrom: now,
          effectiveTo: null,
          conflict: false,
          conflictsWithBeliefId: null,
          changeReason: null,
        },
      }
    ).exec();
    for (const row of activeBefore) {
      await appendBeliefVersion({
        beliefId: row._id,
        eventType: "superseded",
        reason: "superseded by manual activation",
        previousBeliefId: belief._id,
      });
    }
    await appendBeliefVersion({
      beliefId: belief._id,
      eventType: "activated",
      reason: "belief manually activated",
    });

    return NextResponse.json({ ok: true, action });
  }

  if (action === "supersede_active" || action === "archive_belief") {
    await Belief.updateOne(
      { _id: belief._id },
      {
        $set: {
          status: "superseded",
          effectiveTo: now,
          conflict: false,
          conflictsWithBeliefId: null,
        },
      }
    ).exec();
    await appendBeliefVersion({
      beliefId: belief._id,
      eventType: action === "archive_belief" ? "archived" : "superseded",
      reason: action === "archive_belief" ? "belief archived by owner" : "belief manually superseded",
    });
    return NextResponse.json({ ok: true, action });
  }

  if (action === "merge_into_active") {
    const targetObjectId = toObjectId(String(body.targetBeliefId ?? ""));
    if (!targetObjectId) {
      return NextResponse.json({ error: "Missing targetBeliefId" }, { status: 400 });
    }

    const target = await Belief.findById(targetObjectId)
      .lean<{
        _id: Types.ObjectId;
        status: "active" | "superseded" | "draft";
        confidence: number;
        sourceRefs?: Array<{
          sourceType: "voice_note" | "call_log" | "manual";
          sourceId: string;
          createdAt: Date;
        }>;
      } | null>()
      .exec();

    if (!target) {
      return NextResponse.json({ error: "Target belief not found" }, { status: 404 });
    }
    if (target.status !== "active") {
      return NextResponse.json({ error: "Target belief must be active" }, { status: 400 });
    }

    const mergedRefs = dedupeSourceRefs([
      ...(target.sourceRefs ?? []),
      ...(belief.sourceRefs ?? []),
      { sourceType: belief.sourceType, sourceId: belief.sourceId, createdAt: now },
    ]);
    const mergedConfidence = calibrateFromEvidence(
      Math.max(target.confidence ?? 0, belief.confidence ?? 0),
      mergedRefs.length
    );

    await Belief.updateOne(
      { _id: target._id },
      {
        $set: {
          sourceRefs: mergedRefs,
          sourceType: belief.sourceType,
          sourceId: belief.sourceId,
          confidence: mergedConfidence,
          updatedAt: now,
          conflict: false,
          conflictsWithBeliefId: null,
          changeReason: null,
        },
      }
    ).exec();
    await appendBeliefVersion({
      beliefId: target._id,
      eventType: "merged",
      reason: "merged supporting refs from another belief",
      previousBeliefId: belief._id,
    });

    if (String(belief._id) !== String(target._id)) {
      await Belief.updateOne(
        { _id: belief._id },
        {
          $set: {
            status: "superseded",
            effectiveTo: now,
            conflict: false,
            conflictsWithBeliefId: null,
          },
        }
      ).exec();
      await appendBeliefVersion({
        beliefId: belief._id,
        eventType: "superseded",
        reason: "merged into active belief",
        previousBeliefId: target._id,
      });
    }

    return NextResponse.json({ ok: true, action });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
