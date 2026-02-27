import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { recordToolMetric } from "@/lib/agentchat/tool-metrics";
import { connectToDatabase } from "@/lib/db";
import { buildVoiceNotesContext } from "@/lib/voice-notes/service";
import { VoiceNote } from "@/models/VoiceNote";

export const runtime = "nodejs";
const DEFAULT_LIMIT = 2;
const MAX_LIMIT = 2;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

function secureCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const webhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? "";

  if (!webhookSecret) return false;
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return false;
  return secureCompare(token, webhookSecret);
}

type NoteRow = {
  summary: string;
  transcript: string;
  createdAt: Date;
};

export async function GET(req: Request) {
  const startedAt = Date.now();
  const finish = (statusCode: number, success: boolean, errorCode?: string | null) => {
    void recordToolMetric({
      tool: "get_voice_note_context",
      statusCode,
      success,
      latencyMs: Date.now() - startedAt,
      errorCode: errorCode ?? null,
    });
  };

  if (!isAuthorized(req)) {
    finish(401, false, "unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const requestedLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const requestedDays = Number(url.searchParams.get("days") ?? DEFAULT_DAYS);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : DEFAULT_LIMIT)
    );
    const days = Math.min(
      MAX_DAYS,
      Math.max(1, Number.isFinite(requestedDays) ? Math.floor(requestedDays) : DEFAULT_DAYS)
    );
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    await connectToDatabase();
    const rows = await VoiceNote.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select({ summary: 1, transcript: 1, createdAt: 1 })
      .lean<NoteRow[]>()
      .exec();

    const payload = buildVoiceNotesContext(rows);
    finish(200, true);
    return NextResponse.json(payload);
  } catch {
    finish(500, false, "internal_error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
