import { NextResponse } from "next/server";
import { recordToolMetric } from "@/lib/agentchat/tool-metrics";
import { isElevenLabsAuthorized } from "@/lib/user-context-utils";
import { getBestContext } from "@/lib/agentchat/thinking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const startedAt = Date.now();
  const finish = (statusCode: number, success: boolean, errorCode?: string | null) => {
    void recordToolMetric({
      tool: "get_current_thinking",
      statusCode,
      success,
      latencyMs: Date.now() - startedAt,
      errorCode: errorCode ?? null,
    });
  };

  if (!isElevenLabsAuthorized(req)) {
    finish(401, false, "unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const topicParam = String(url.searchParams.get("topic") ?? "").trim();
    const requestedLimit = Number(url.searchParams.get("limit") ?? 3);
    const limit = Math.min(5, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 3));
    const ranked = await getBestContext({ topic: topicParam, limit });
    const updatedAt = ranked.beliefs[0]?.updatedAt ?? null;

    finish(200, true);
    return NextResponse.json({
      updatedAt,
      beliefs: ranked.beliefs.map((belief) => ({
        topic: belief.topic,
        statement: belief.statement,
        confidence: belief.confidence,
        freshnessScore: belief.freshnessScore,
        retrievalScore: belief.retrievalScore,
        effectiveFrom: belief.effectiveFrom,
        updatedAt: belief.updatedAt,
        sourceType: belief.sourceType ?? "manual",
        evidenceCount: belief.evidenceCount,
        confidenceReason: belief.confidenceReason ?? null,
        lastEvidenceAt: belief.updatedAt,
      })),
    });
  } catch {
    finish(500, false, "internal_error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
