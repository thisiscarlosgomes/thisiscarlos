import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import {
  recordCallInteraction,
  queueCallSummaryRetry,
  updateCallSummaryBySid,
  updateLatestCallSummaryByPhone,
} from "@/lib/agentchat/call-log";
import { reflectFromSource } from "@/lib/agentchat/reflection";
import { OPENAI_MODEL } from "@/lib/agentchat/config";
import { evaluateCallMemoryFit } from "@/lib/agentchat/thinking";
import { summarizeVoiceNote } from "@/lib/voice-notes/service";
import { VOICE_NOTES_OWNER_ID } from "@/lib/voice-notes/auth";
import { normalizePhoneNumber } from "@/lib/user-context-utils";
import { connectToDatabase } from "@/lib/db";
import { CallLog } from "@/models/CallLog";
import { User } from "@/models/User";
import { VoiceNote } from "@/models/VoiceNote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorizedHmac(req: Request, rawPayload: string): boolean {
  const signatureHeader = req.headers.get("elevenlabs-signature") ?? "";
  const secret =
    process.env.ELEVENLABS_POST_CALL_WEBHOOK_SECRET ??
    process.env.ELEVENLABS_WEBHOOK_SECRET ??
    "";

  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2) ?? "";
  const provided = parts.find((part) => part.startsWith("v0=")) ?? "";

  if (!timestamp || !provided) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const maxAgeSeconds = 30 * 60;
  if (Math.abs(nowSeconds - timestampSeconds) > maxAgeSeconds) return false;

  const signed = `${timestamp}.${rawPayload}`;
  const expected = `v0=${createHmac("sha256", secret).update(signed, "utf8").digest("hex")}`;
  return safeEqualHex(expected, provided);
}

function clip(text: string, max = 180): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function isUnusableSummary(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (normalized.length < 12) return true;
  return [
    "summary couldn't be generated",
    "summary could not be generated",
    "unable to generate summary",
    "failed to generate summary",
    "no summary available",
    "summary unavailable",
    "transcript unavailable",
    "no transcript available",
    "call ended",
    "conversation ended",
  ].some((phrase) => normalized.includes(phrase));
}

function anonymize(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .replace(/\b\d{5,}\b/g, "[number]")
    .replace(/\b(?:https?:\/\/|www\.)\S+\b/gi, "[link]");
}

function readDurationSeconds(data: Record<string, unknown>): number {
  const candidates = [
    data.duration_seconds,
    data.call_duration_seconds,
    data.call_duration_secs,
    (data.metadata as Record<string, unknown> | undefined)?.duration_seconds,
    (data.metadata as Record<string, unknown> | undefined)?.call_duration_seconds,
    (data.metadata as Record<string, unknown> | undefined)?.call_duration_secs,
  ];

  for (const candidate of candidates) {
    const n = Number(candidate ?? 0);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

function getStringCandidate(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = key.split(".").reduce<unknown>((acc, part) => {
      if (!acc || typeof acc !== "object") return undefined;
      return (acc as Record<string, unknown>)[part];
    }, data);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function extractTurnTexts(data: Record<string, unknown>): Array<{ role: string; text: string }> {
  const transcriptCandidates: unknown[] = [
    data.transcript,
    data.conversation_transcript,
    (data.metadata as Record<string, unknown> | undefined)?.transcript,
    (data.metadata as Record<string, unknown> | undefined)?.conversation_transcript,
  ];

  const transcript = transcriptCandidates.find(Array.isArray);
  if (!Array.isArray(transcript)) return [];

  return transcript
    .map((turn) => {
      if (!turn || typeof turn !== "object") return null;
      const row = turn as Record<string, unknown>;
      const roleRaw = row.role ?? row.speaker ?? "unknown";
      const role = String(roleRaw).toLowerCase();

      let text = "";
      if (typeof row.text === "string") {
        text = row.text;
      } else if (typeof row.message === "string") {
        text = row.message;
      } else if (typeof row.content === "string") {
        text = row.content;
      } else if (Array.isArray(row.content)) {
        text = row.content
          .map((part) => {
            if (typeof part === "string") return part;
            if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
              return String((part as Record<string, unknown>).text);
            }
            return "";
          })
          .join(" ");
      }

      const cleaned = anonymize(clip(text, 2000));
      if (!cleaned) return null;
      return { role, text: cleaned };
    })
    .filter((row): row is { role: string; text: string } => Boolean(row));
}

function buildSummary(turns: Array<{ role: string; text: string }>): string {
  const userTurn = turns.find((t) => t.role.includes("user") || t.role.includes("caller"));
  const agentTurn = turns.find((t) => t.role.includes("agent") || t.role.includes("assistant"));

  if (userTurn) return `We chatted about ${clip(userTurn.text, 120)}.`;
  if (agentTurn) return `We had a quick chat and exchanged ideas about ${clip(agentTurn.text, 120)}.`;
  return "Voice call with Carlos AI";
}

function extractSummaryText(
  data: Record<string, unknown>,
  turns: Array<{ role: string; text: string }>
): string {
  const direct = getStringCandidate(data, [
    "summary",
    "call_summary",
    "conversation_summary",
    "analysis.transcript_summary",
    "analysis.summary",
    "metadata.summary",
    "metadata.call_summary",
    "metadata.conversation_summary",
  ]);
  if (direct) {
    const cleaned = anonymize(clip(direct, 180));
    if (!isUnusableSummary(cleaned)) return cleaned;
  }

  return buildSummary(turns);
}

function compactTurnsForModel(turns: Array<{ role: string; text: string }>): string {
  return turns
    .slice(0, 10)
    .map((turn) => {
      const speaker = turn.role.includes("agent") || turn.role.includes("assistant") ? "Agent" : "Caller";
      return `${speaker}: ${turn.text}`;
    })
    .join("\n");
}

type FriendlySummaryResult = {
  text: string | null;
  errorReason: string | null;
};

function getAiErrorReason(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown_error";
  const maybe = error as { name?: string; message?: string; statusCode?: number; cause?: unknown };
  const message = String(maybe.message ?? "").toLowerCase();
  if (maybe.statusCode === 429 || message.includes("rate limit")) return "rate_limited";
  if (maybe.statusCode === 401 || maybe.statusCode === 403 || message.includes("unauthorized")) return "auth_error";
  if (message.includes("timeout")) return "timeout";
  if (message.includes("network")) return "network_error";
  return maybe.name ? String(maybe.name).toLowerCase() : "unknown_error";
}

async function generateFriendlySummary(
  turns: Array<{ role: string; text: string }>
): Promise<FriendlySummaryResult> {
  if (!process.env.OPENAI_API_KEY) return { text: null, errorReason: "missing_openai_key" };
  if (turns.length === 0) return { text: null, errorReason: "empty_transcript" };

  try {
    const transcript = compactTurnsForModel(turns);
    if (!transcript) return { text: null, errorReason: "empty_transcript" };

    const { text } = await generateText({
      model: openai(OPENAI_MODEL),
      system:
        "Write a warm one-line chat moment for product UI in Carlos mini-me voice. Make it feel like a casual conversation about tech, life, or ideas. Keep it anonymous and concrete. No names, phone numbers, links, or sensitive data. Avoid report-style wording like 'caller asked' or 'caller inquired'.",
      prompt: [
        "Return only one sentence under 20 words.",
        "Style should feel like: 'We had a quick chat about...' or 'We traded thoughts on...'.",
        "Keep it natural and human, not formal.",
        "Transcript:",
        transcript,
      ].join("\n"),
      maxOutputTokens: 60,
      temperature: 0.2,
    });

    const cleaned = anonymize(clip(text, 180));
    return {
      text: cleaned || null,
      errorReason: cleaned ? null : "empty_model_output",
    };
  } catch (error) {
    console.warn("OpenAI post-call summary generation failed", error);
    return { text: null, errorReason: getAiErrorReason(error) };
  }
}

function shouldProcessEvent(eventType: string): boolean {
  if (!eventType) return true;
  return (
    eventType.includes("post_call") ||
    eventType.includes("transcript") ||
    eventType.includes("conversation.ended") ||
    eventType.includes("conversation_ended")
  );
}

function inferCallAttributes(summary: string): {
  topic: string | null;
  intent: string | null;
  sentiment: "positive" | "neutral" | "negative";
  resolved: boolean | null;
} {
  const text = summary.toLowerCase();
  const topicMatch = summary
    .replace(/^caller asked:\s*/i, "")
    .replace(/^conversation highlight:\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .trim()
    .slice(0, 80);

  const sentiment: "positive" | "neutral" | "negative" =
    /(great|good|helpful|clear|thanks|resolved|worked)/.test(text)
      ? "positive"
      : /(frustrat|confus|not working|issue|problem|angry)/.test(text)
      ? "negative"
      : "neutral";

  const resolved =
    /(resolved|fixed|clear now|that helps|makes sense)/.test(text)
      ? true
      : /(still|not sure|unclear|doesn'?t work|problem remains)/.test(text)
      ? false
      : null;

  const intent =
    /(buy|price|cost|credit|pay)/.test(text)
      ? "pricing"
      : /(start|build|launch|ship|deploy)/.test(text)
      ? "build"
      : /(invest|market|fund|token|crypto)/.test(text)
      ? "investing"
      : /(help|how|what|why|when)/.test(text)
      ? "advice"
      : null;

  return {
    topic: topicMatch || null,
    intent,
    sentiment,
    resolved,
  };
}

function buildTopicFallbackSummary(topic: string | null, intent: string | null): string {
  if (topic) return `we had a quick call about ${clip(topic, 80).toLowerCase()}.`;
  if (intent) return `we had a quick call focused on ${clip(intent, 60).toLowerCase()}.`;
  return "we had a quick call and exchanged a few ideas.";
}

function getThoughtUpdateAllowedCallers(): Set<string> {
  const raw = String(process.env.THOUGHT_UPDATE_ALLOWED_CALLERS ?? "").trim();
  if (!raw) return new Set();
  const normalized = raw
    .split(",")
    .map((value) => normalizePhoneNumber(String(value ?? "")))
    .filter((value): value is string => Boolean(value));
  return new Set(normalized);
}

function getThoughtUpdateTriggers(): string[] {
  const raw = String(process.env.THOUGHT_UPDATE_TRIGGER_PHRASES ?? "").trim();
  const defaults = ["update thought", "update my thought", "new thought"];
  if (!raw) return defaults;
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isCallerRole(role: string): boolean {
  const normalized = String(role ?? "").toLowerCase();
  return (
    normalized.includes("caller") ||
    normalized.includes("user") ||
    normalized.includes("customer") ||
    normalized.includes("human") ||
    normalized.includes("participant")
  );
}

function extractCallerThoughtUpdate(
  turns: Array<{ role: string; text: string }>
): { triggerMatched: boolean; text: string } | null {
  const triggers = getThoughtUpdateTriggers();
  const tryParse = (rows: Array<{ role: string; text: string }>): { triggerMatched: boolean; text: string } | null => {
    if (rows.length === 0) return null;
    for (let i = 0; i < rows.length; i += 1) {
      const turnText = rows[i].text.trim();
      const lower = turnText.toLowerCase();
      const matchedTrigger = triggers.find((trigger) => lower.includes(trigger));
      if (!matchedTrigger) continue;

      const inlinePattern = /(?:update(?:\s+my)?\s+thought|new thought)\s*[:\-]?\s*(.+)$/i;
      const inlineMatch = turnText.match(inlinePattern);
      const inlineText = inlineMatch?.[1]?.trim() ?? "";
      if (inlineText.length >= 10) {
        return { triggerMatched: true, text: clip(inlineText, 2000) };
      }

      const nextText = rows[i + 1]?.text?.trim() ?? "";
      if (nextText.length >= 10) {
        return { triggerMatched: true, text: clip(nextText, 2000) };
      }

      const merged = [turnText, nextText].filter(Boolean).join(" ").trim();
      if (merged.length >= 10) {
        return { triggerMatched: true, text: clip(merged, 2000) };
      }

      return { triggerMatched: true, text: "" };
    }
    return null;
  };

  const callerTurns = turns.filter((turn) => isCallerRole(turn.role));
  const callerParsed = tryParse(callerTurns);
  if (callerParsed) return callerParsed;

  // Fallback for provider role mismatches: parse full transcript.
  const anyTurnParsed = tryParse(turns);
  if (anyTurnParsed) return anyTurnParsed;

  for (let i = 0; i < callerTurns.length; i += 1) {
    const turnText = callerTurns[i].text.trim();
    const lower = turnText.toLowerCase();
    const matchedTrigger = triggers.find((trigger) => lower.includes(trigger));
    if (!matchedTrigger) continue;

    const inlinePattern = /(?:update(?:\s+my)?\s+thought|new thought)\s*[:\-]?\s*(.+)$/i;
    const inlineMatch = turnText.match(inlinePattern);
    const inlineText = inlineMatch?.[1]?.trim() ?? "";
    if (inlineText.length >= 10) {
      return { triggerMatched: true, text: clip(inlineText, 2000) };
    }

    const nextCaller = callerTurns[i + 1]?.text?.trim() ?? "";
    if (nextCaller.length >= 10) {
      return { triggerMatched: true, text: clip(nextCaller, 2000) };
    }

    const merged = [turnText, nextCaller].filter(Boolean).join(" ").trim();
    if (merged.length >= 10) {
      return { triggerMatched: true, text: clip(merged, 2000) };
    }

    return { triggerMatched: true, text: "" };
  }

  return null;
}

async function resolveTrustedCallerNumber(input: {
  normalizedPhoneNumber: string | null;
  callSid: string;
}): Promise<string | null> {
  if (input.normalizedPhoneNumber) return input.normalizedPhoneNumber;
  if (!input.callSid) return null;

  await connectToDatabase();
  const call = await CallLog.findOne({ callSid: input.callSid })
    .select({ userId: 1 })
    .lean<{ userId?: string | null } | null>()
    .exec();
  if (!call?.userId) return null;

  const user = await User.findById(call.userId)
    .select({ phoneNumber: 1 })
    .lean<{ phoneNumber?: string | null } | null>()
    .exec();
  return normalizePhoneNumber(String(user?.phoneNumber ?? ""));
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!isAuthorizedHmac(req, rawBody)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const eventData =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : payload;
  const eventType = String(payload.type ?? payload.event ?? "").toLowerCase();
  if (!shouldProcessEvent(eventType)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const callSid = getStringCandidate(eventData, [
    "metadata.phone_call.call_sid",
    "metadata.phone_call.callSid",
    "metadata.call_sid",
    "metadata.callSid",
    "phone_call.call_sid",
    "phone_call.callSid",
    "call_sid",
    "callSid",
    "twilio.call_sid",
    "twilio.callSid",
    "conversation_initiation_client_data.dynamic_variables.call_sid",
    "conversation_initiation_client_data.dynamic_variables.twilio_call_sid",
    "conversation_initiation_client_data.dynamic_variables.callSid",
    "conversation_initiation_client_data.dynamic_variables.twilioCallSid",
  ]);
  const phoneNumber = getStringCandidate(eventData, [
    "metadata.phone_call.external_number",
    "metadata.phone_call.caller_number",
    "metadata.phone_call.from_number",
    "metadata.phone_call.fromNumber",
    "metadata.from_number",
    "metadata.fromNumber",
    "metadata.from",
    "from_number",
    "fromNumber",
    "phone_call.external_number",
    "phone_call.caller_number",
    "phone_call.from_number",
    "phone_call.fromNumber",
    "conversation_initiation_client_data.dynamic_variables.phone_number",
    "conversation_initiation_client_data.dynamic_variables.caller_id",
    "conversation_initiation_client_data.dynamic_variables.system__caller_id",
    "conversation_initiation_client_data.dynamic_variables.from_number",
    "conversation_initiation_client_data.dynamic_variables.system__from_number",
    "conversation_initiation_client_data.dynamic_variables.fromNumber",
  ]) || getStringCandidate(payload, [
    "metadata.phone_call.external_number",
    "metadata.phone_call.caller_number",
    "metadata.phone_call.from_number",
    "metadata.phone_call.fromNumber",
    "metadata.from_number",
    "metadata.fromNumber",
    "metadata.from",
    "from_number",
    "fromNumber",
    "phone_call.external_number",
    "phone_call.caller_number",
    "phone_call.from_number",
    "phone_call.fromNumber",
    "conversation_initiation_client_data.dynamic_variables.phone_number",
    "conversation_initiation_client_data.dynamic_variables.caller_id",
    "conversation_initiation_client_data.dynamic_variables.system__caller_id",
    "conversation_initiation_client_data.dynamic_variables.from_number",
    "conversation_initiation_client_data.dynamic_variables.system__from_number",
    "conversation_initiation_client_data.dynamic_variables.fromNumber",
  ]);
  const durationSeconds = readDurationSeconds(eventData);
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const turns = extractTurnTexts(eventData);
  const fallbackSummary = extractSummaryText(eventData, turns);
  const aiSummary = await generateFriendlySummary(turns);
  const draftSummary = aiSummary.text ?? fallbackSummary;
  const draftAttrs = inferCallAttributes(draftSummary);
  const summary = isUnusableSummary(draftSummary)
    ? buildTopicFallbackSummary(draftAttrs.topic, draftAttrs.intent)
    : draftSummary;
  const attrs = inferCallAttributes(summary);
  const summarySource = aiSummary.text
    ? "ai"
    : draftSummary === fallbackSummary && !isUnusableSummary(fallbackSummary)
    ? "webhook_or_transcript_fallback"
    : "safe_fallback";
  const summaryErrorReason = aiSummary.errorReason;
  const memoryEval = await evaluateCallMemoryFit({
    summary,
    topic: attrs.topic,
  });
  const transcriptPreview = compactTurnsForModel(turns);
  const shouldQueueSummaryRetry =
    !aiSummary.text &&
    turns.length > 0 &&
    Boolean(process.env.OPENAI_API_KEY) &&
    aiSummary.errorReason !== "missing_openai_key";

  console.info("ElevenLabs post-call webhook received", {
    eventType,
    hasCallSid: Boolean(callSid),
    hasPhoneNumber: Boolean(phoneNumber),
    hasSummary: Boolean(summary && summary !== "Voice call with Carlos AI"),
    usedAiSummary: Boolean(aiSummary.text),
    summarySource,
    summaryErrorReason,
  });

  if (callSid) {
    await updateCallSummaryBySid({
      callSid,
      summary,
      durationSeconds,
      topic: attrs.topic,
      intent: attrs.intent,
      sentiment: attrs.sentiment,
      resolved: attrs.resolved,
      summarySource,
      summaryErrorReason,
      memoryFitScore: memoryEval.fitScore,
      memoryMismatchReason: memoryEval.mismatchReason,
      memoryBestBeliefId: memoryEval.bestBeliefId,
    });
  }

  if (!callSid && phoneNumber) {
    await updateLatestCallSummaryByPhone({
      phoneNumber,
      summary,
      durationSeconds,
    });
  }

  if (callSid && phoneNumber) {
    await recordCallInteraction({
      phoneNumber,
      callSid,
      durationSeconds,
      summary,
      topic: attrs.topic,
      intent: attrs.intent,
      sentiment: attrs.sentiment,
      resolved: attrs.resolved,
      billingMode: "unknown",
      summarySource,
      summaryErrorReason,
      memoryFitScore: memoryEval.fitScore,
      memoryMismatchReason: memoryEval.mismatchReason,
      memoryBestBeliefId: memoryEval.bestBeliefId,
    });
  }

  if (shouldQueueSummaryRetry) {
    await queueCallSummaryRetry({
      callSid,
      phoneNumber,
      transcriptPreview: clip(transcriptPreview, 2800),
      summaryErrorReason,
      delaySeconds: 90,
    });
  }

  let thoughtUpdateCaptured = false;
  try {
    const allowlist = getThoughtUpdateAllowedCallers();
    const trustedCallerPhone = await resolveTrustedCallerNumber({
      normalizedPhoneNumber,
      callSid,
    });
    const isTrustedCaller =
      trustedCallerPhone && allowlist.size > 0 ? allowlist.has(trustedCallerPhone) : false;
    const thoughtUpdate = extractCallerThoughtUpdate(turns);

    console.info("Post-call thought update gate", {
      hasTrigger: Boolean(thoughtUpdate?.triggerMatched),
      triggerHasText: Boolean(thoughtUpdate?.text),
      normalizedPhoneNumber: normalizedPhoneNumber ?? null,
      trustedCallerPhone: trustedCallerPhone ?? null,
      allowlistSize: allowlist.size,
      isTrustedCaller,
    });

    if (isTrustedCaller && thoughtUpdate?.triggerMatched && thoughtUpdate.text) {
      const transcript = clip(thoughtUpdate.text, 5000);
      const summary = await summarizeVoiceNote(transcript);

      const created = await VoiceNote.create({
        ownerId: VOICE_NOTES_OWNER_ID,
        audioMimeType: "audio/call-thought",
        audioData: Buffer.alloc(0),
        durationSeconds: Math.max(0, durationSeconds),
        transcript,
        summary,
      });

      await reflectFromSource({
        sourceType: "voice_note",
        sourceId: String(created._id),
        text: `${created.summary}. ${created.transcript}`,
        topicHint: created.summary,
        createdAt: created.createdAt,
      });
      thoughtUpdateCaptured = true;
    }
  } catch (error) {
    console.error("Post-call thought update capture failed", error);
  }

  try {
    await reflectFromSource({
      sourceType: "call_log",
      sourceId: callSid || phoneNumber || `event-${Date.now()}`,
      text: summary,
      topicHint: attrs.topic,
    });
  } catch (error) {
    console.error("Post-call reflection failed", error);
  }

  return NextResponse.json({ received: true, thoughtUpdateCaptured });
}
