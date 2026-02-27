import { timingSafeEqual } from "node:crypto";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { OPENAI_MODEL } from "@/lib/agentchat/config";
import { updateCallSummaryBySid } from "@/lib/agentchat/call-log";
import { evaluateCallMemoryFit } from "@/lib/agentchat/thinking";
import { CallLog } from "@/models/CallLog";
import { User } from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RETRIES = 3;

function secureCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const secret =
    process.env.CALL_SUMMARY_RETRY_SECRET ??
    process.env.INTERNAL_CRON_SECRET ??
    "";

  if (!secret) return false;
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return false;
  return secureCompare(token, secret);
}

function clip(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function getErrorReason(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown_error";
  const maybe = error as { name?: string; message?: string; statusCode?: number };
  const message = String(maybe.message ?? "").toLowerCase();
  if (maybe.statusCode === 429 || message.includes("rate limit")) return "rate_limited";
  if (maybe.statusCode === 401 || maybe.statusCode === 403 || message.includes("unauthorized")) return "auth_error";
  if (message.includes("timeout")) return "timeout";
  if (message.includes("network")) return "network_error";
  return maybe.name ? String(maybe.name).toLowerCase() : "unknown_error";
}

async function generateRetrySummary(transcript: string): Promise<string> {
  const normalized = clip(transcript, 2600);
  if (!normalized) throw new Error("missing_transcript_preview");
  if (!process.env.OPENAI_API_KEY) throw new Error("missing_openai_key");

  const { text } = await generateText({
    model: openai(OPENAI_MODEL),
    system:
      "Write a warm one-line chat moment for product UI in Carlos mini-me voice. Keep it anonymous and concrete.",
    prompt: [
      "Return exactly one sentence under 20 words.",
      "Avoid formal report wording like caller asked/inquired.",
      `Transcript:\n${normalized}`,
    ].join("\n"),
    maxOutputTokens: 60,
    temperature: 0.2,
  });

  return clip(text || "", 180);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const requestedLimit = Number(url.searchParams.get("limit") ?? 10);
  const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 10));
  const now = new Date();

  await connectToDatabase();
  const rows = await CallLog.find({
    summaryRetryNeeded: true,
    summaryRetryScheduledAt: { $lte: now },
    summaryRetryCount: { $lt: MAX_RETRIES },
  })
    .sort({ summaryRetryScheduledAt: 1, updatedAt: 1 })
    .limit(limit)
    .select({
      _id: 1,
      userId: 1,
      callSid: 1,
      topic: 1,
      createdAt: 1,
      summaryRetryCount: 1,
      summaryTranscriptPreview: 1,
    })
    .lean<
      Array<{
        _id: Types.ObjectId;
        userId: Types.ObjectId;
        callSid?: string | null;
        topic?: string | null;
        createdAt: Date;
        summaryRetryCount?: number;
        summaryTranscriptPreview?: string | null;
      }>
    >()
    .exec();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    processed += 1;
    const retryCount = Math.max(0, Number(row.summaryRetryCount ?? 0));
    const attempt = retryCount + 1;
    const transcriptPreview = String(row.summaryTranscriptPreview ?? "").trim();

    if (!transcriptPreview) {
      failed += 1;
      await CallLog.updateOne(
        { _id: row._id },
        {
          $set: {
            summaryRetryNeeded: false,
            summaryRetryCount: attempt,
            summaryRetryScheduledAt: null,
            summaryRetryLastError: "missing_transcript_preview",
          },
        }
      ).exec();
      continue;
    }

    try {
      const summary = await generateRetrySummary(transcriptPreview);
      if (!summary) {
        throw new Error("empty_model_output");
      }

      if (row.callSid) {
        await updateCallSummaryBySid({
          callSid: row.callSid,
          summary,
          topic: row.topic ?? null,
          summarySource: "ai_retry",
          summaryErrorReason: null,
        });
      } else {
        await CallLog.updateOne(
          { _id: row._id },
          {
            $set: {
              summary,
              summarySource: "ai_retry",
              summaryErrorReason: null,
            },
          }
        ).exec();
      }

      const memoryEval = await evaluateCallMemoryFit({
        summary,
        topic: row.topic ?? null,
      });

      await CallLog.updateOne(
        { _id: row._id },
        {
          $set: {
            summaryRetryNeeded: false,
            summaryRetryCount: attempt,
            summaryRetryScheduledAt: null,
            summaryRetryLastError: null,
            memoryFitScore: memoryEval.fitScore,
            memoryMismatchReason: memoryEval.mismatchReason,
            memoryBestBeliefId: memoryEval.bestBeliefId,
            memoryEvaluatedAt: new Date(),
            summarySource: "ai_retry",
            summaryErrorReason: null,
          },
        }
      ).exec();

      await User.updateOne(
        {
          _id: row.userId,
          $or: [{ lastCallAt: null }, { lastCallAt: { $lte: row.createdAt } }],
        },
        {
          $set: {
            lastCallSummary: summary,
            lastSeenAt: new Date(),
          },
        }
      ).exec();

      succeeded += 1;
    } catch (error) {
      failed += 1;
      const reason = getErrorReason(error);
      const exhausted = attempt >= MAX_RETRIES;
      const delaySeconds = Math.min(1800, 90 * 2 ** retryCount);

      await CallLog.updateOne(
        { _id: row._id },
        {
          $set: {
            summaryRetryNeeded: !exhausted,
            summaryRetryCount: attempt,
            summaryRetryScheduledAt: exhausted ? null : new Date(Date.now() + delaySeconds * 1000),
            summaryRetryLastError: reason,
            summaryErrorReason: reason,
          },
        }
      ).exec();
    }
  }

  return Response.json({
    ok: true,
    processed,
    succeeded,
    failed,
    limit,
  });
}
