import { connectToDatabase } from "@/lib/db";
import { CallLog } from "@/models/CallLog";
import { CallReservation } from "@/models/CallReservation";
import { User } from "@/models/User";
import { ensureUser } from "@/lib/agentchat/store";

function normalizePhoneNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const stripped = trimmed.replace(/[\s\-().]/g, "");
  const withPlus = stripped.startsWith("00") ? `+${stripped.slice(2)}` : stripped;
  const normalized = withPlus.startsWith("+") ? withPlus : `+${withPlus}`;

  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

function maskPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/[^\d]/g, "");
  const last4 = digits.slice(-4).padStart(4, "*");
  return `***-***-${last4}`;
}

function sanitizePublicSummary(value: string): string {
  const text = String(value ?? "").trim();
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  if (!text) return "we had a quick call.";
  if (
    normalized.includes("summary couldn't be generated") ||
    normalized.includes("summary could not be generated") ||
    normalized.includes("unable to generate summary") ||
    normalized.includes("failed to generate summary") ||
    normalized.includes("no summary available") ||
    normalized.includes("summary unavailable") ||
    normalized.includes("transcript unavailable")
  ) {
    return "we had a quick call.";
  }
  return text;
}

function pickVariantIndex(seed: string, size: number): number {
  if (size <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % size;
}

function diversifySummaryLead(summary: string, seed: string): string {
  const text = String(summary ?? "").trim();
  if (!text) return text;

  const variants = [
    "we had a quick chat on ",
    "we explored ",
    "we unpacked ",
    "we riffed on ",
    "we exchanged ideas on ",
  ];

  const lower = text.toLowerCase();
  const startsWithKnownLead =
    lower.startsWith("we traded thoughts on ") ||
    lower.startsWith("we chatted about ") ||
    lower.startsWith("we had a quick chat about ");
  if (!startsWithKnownLead) return text;

  const topic = text.replace(/^we (traded thoughts on|chatted about|had a quick chat about)\s+/i, "");
  const prefix = variants[pickVariantIndex(seed, variants.length)];
  return `${prefix}${topic}`;
}

export async function recordCallInteraction(input: {
  phoneNumber: string;
  callSid: string;
  durationSeconds: number;
  summary?: string;
  billingMode?: "free-daily" | "paid" | "unknown";
  topic?: string | null;
  intent?: string | null;
  sentiment?: "positive" | "neutral" | "negative" | null;
  resolved?: boolean | null;
  summarySource?: string | null;
  summaryErrorReason?: string | null;
  memoryFitScore?: number | null;
  memoryMismatchReason?: string | null;
  memoryBestBeliefId?: string | null;
}) {
  const normalizedPhone = normalizePhoneNumber(input.phoneNumber);
  if (!normalizedPhone || !input.callSid) return;

  await connectToDatabase();

  const user = await User.findOneAndUpdate(
    { phoneNumber: normalizedPhone },
    {
      $setOnInsert: {
        firstName: null,
        callCredits: 0,
        totalCalls: 0,
        totalCallSeconds: 0,
        lastCallSummary: null,
        tags: [],
      },
      $set: { lastSeenAt: new Date() },
    },
    { upsert: true, returnDocument: "after" }
  )
    .select({ _id: 1, walletUserId: 1 })
    .lean<{ _id: string; walletUserId?: string | null } | null>()
    .exec();

  if (!user?._id) return;

  // Keep a stable wallet namespace for phone-based callers.
  if (!user.walletUserId) {
    const walletUserId = `phone:${normalizedPhone}`;
    await ensureUser(walletUserId);
    await User.updateOne({ _id: user._id }, { $set: { walletUserId } }).exec();
  }

  await CallLog.updateOne(
    { callSid: input.callSid },
    {
      $setOnInsert: {
        userId: user._id,
        callSid: input.callSid,
        summary: input.summary?.trim() || "Voice call with Carlos AI",
        topic: input.topic ?? null,
        intent: input.intent ?? null,
        sentiment: input.sentiment ?? null,
        resolved: typeof input.resolved === "boolean" ? input.resolved : null,
        billingMode: input.billingMode ?? "unknown",
        summarySource: input.summarySource?.trim() || "unknown",
        summaryErrorReason: input.summaryErrorReason?.trim() || null,
        memoryFitScore:
          typeof input.memoryFitScore === "number"
            ? Math.max(0, Math.min(1, input.memoryFitScore))
            : null,
        memoryMismatchReason: input.memoryMismatchReason ?? null,
        memoryBestBeliefId: input.memoryBestBeliefId ?? null,
        memoryEvaluatedAt:
          typeof input.memoryFitScore === "number" || input.memoryMismatchReason
            ? new Date()
            : null,
      },
      ...(input.summary?.trim()
        ? {
            $set: {
              summary: input.summary.trim(),
              ...(input.topic !== undefined ? { topic: input.topic } : {}),
              ...(input.intent !== undefined ? { intent: input.intent } : {}),
              ...(input.sentiment !== undefined ? { sentiment: input.sentiment } : {}),
              ...(input.resolved !== undefined ? { resolved: input.resolved } : {}),
              ...(input.billingMode ? { billingMode: input.billingMode } : {}),
              ...(input.summarySource !== undefined ? { summarySource: input.summarySource?.trim() || "unknown" } : {}),
              ...(input.summaryErrorReason !== undefined ? { summaryErrorReason: input.summaryErrorReason?.trim() || null } : {}),
              ...(typeof input.memoryFitScore === "number"
                ? { memoryFitScore: Math.max(0, Math.min(1, input.memoryFitScore)) }
                : {}),
              ...(input.memoryMismatchReason !== undefined
                ? { memoryMismatchReason: input.memoryMismatchReason }
                : {}),
              ...(input.memoryBestBeliefId !== undefined
                ? { memoryBestBeliefId: input.memoryBestBeliefId }
                : {}),
              ...(typeof input.memoryFitScore === "number" || input.memoryMismatchReason !== undefined
                ? { memoryEvaluatedAt: new Date() }
                : {}),
            },
          }
        : {}),
      $max: {
        durationSeconds: Math.max(0, Math.floor(input.durationSeconds)),
      },
    },
    { upsert: true }
  ).exec();

  const [stats, latestCall] = await Promise.all([
    CallLog.aggregate<{ totalCalls: number; totalCallSeconds: number; lastCallAt: Date }>([
      { $match: { userId: user._id } },
      {
        $group: {
          _id: "$userId",
          totalCalls: { $sum: 1 },
          totalCallSeconds: { $sum: "$durationSeconds" },
          lastCallAt: { $max: "$createdAt" },
        },
      },
    ]).exec(),
    CallLog.findOne({ userId: user._id })
      .sort({ createdAt: -1 })
      .select({ summary: 1, createdAt: 1 })
      .lean<{ summary?: string; createdAt?: Date } | null>()
      .exec(),
  ]);

  const row = stats[0];
  if (row) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          totalCalls: Math.max(0, row.totalCalls ?? 0),
          totalCallSeconds: Math.max(0, row.totalCallSeconds ?? 0),
          lastCallAt: row.lastCallAt ?? null,
          lastCallSummary: latestCall?.summary?.trim() || null,
          lastSeenAt: new Date(),
        },
      }
    ).exec();
  }
}

export async function updateCallSummaryBySid(input: {
  callSid: string;
  summary: string;
  durationSeconds?: number;
  topic?: string | null;
  intent?: string | null;
  sentiment?: "positive" | "neutral" | "negative" | null;
  resolved?: boolean | null;
  summarySource?: string | null;
  summaryErrorReason?: string | null;
  memoryFitScore?: number | null;
  memoryMismatchReason?: string | null;
  memoryBestBeliefId?: string | null;
}) {
  if (!input.callSid || !input.summary.trim()) return;
  await connectToDatabase();
  await CallLog.updateOne(
    { callSid: input.callSid },
    {
      $set: {
        summary: input.summary.trim(),
        ...(input.topic !== undefined ? { topic: input.topic } : {}),
        ...(input.intent !== undefined ? { intent: input.intent } : {}),
        ...(input.sentiment !== undefined ? { sentiment: input.sentiment } : {}),
        ...(input.resolved !== undefined ? { resolved: input.resolved } : {}),
        ...(input.summarySource !== undefined ? { summarySource: input.summarySource?.trim() || "unknown" } : {}),
        ...(input.summaryErrorReason !== undefined ? { summaryErrorReason: input.summaryErrorReason?.trim() || null } : {}),
        ...(typeof input.memoryFitScore === "number"
          ? { memoryFitScore: Math.max(0, Math.min(1, input.memoryFitScore)) }
          : {}),
        ...(input.memoryMismatchReason !== undefined
          ? { memoryMismatchReason: input.memoryMismatchReason }
          : {}),
        ...(input.memoryBestBeliefId !== undefined ? { memoryBestBeliefId: input.memoryBestBeliefId } : {}),
        ...(typeof input.memoryFitScore === "number" || input.memoryMismatchReason !== undefined
          ? { memoryEvaluatedAt: new Date() }
          : {}),
      },
    }
  ).exec();

  const call = await CallLog.findOne({ callSid: input.callSid })
    .select({ userId: 1, createdAt: 1, summary: 1 })
    .lean<{ userId: string; createdAt: Date; summary: string } | null>()
    .exec();

  if (call?.userId) {
    await User.updateOne(
      {
        _id: call.userId,
        $or: [{ lastCallAt: null }, { lastCallAt: { $lte: call.createdAt } }],
      },
      {
        $set: {
          lastCallAt: call.createdAt,
          lastCallSummary: call.summary?.trim() || null,
          lastSeenAt: new Date(),
        },
      }
    ).exec();
  }
}

export async function linkPhoneToWalletUser(input: { phoneNumber: string; walletUserId: string }) {
  const normalizedPhone = normalizePhoneNumber(input.phoneNumber);
  const walletUserId = input.walletUserId.trim();
  if (!normalizedPhone || !walletUserId) return;

  await ensureUser(walletUserId);
  await connectToDatabase();
  await User.updateOne(
    { phoneNumber: normalizedPhone },
    {
      $setOnInsert: {
        firstName: null,
        callCredits: 0,
        totalCalls: 0,
        totalCallSeconds: 0,
        lastCallSummary: null,
        tags: [],
      },
      $set: {
        walletUserId,
        lastSeenAt: new Date(),
      },
    },
    { upsert: true }
  ).exec();
}

export async function updateLatestCallSummaryByPhone(input: {
  phoneNumber: string;
  summary: string;
  durationSeconds?: number;
}) {
  const normalizedPhone = normalizePhoneNumber(input.phoneNumber);
  if (!normalizedPhone || !input.summary.trim()) return;

  await connectToDatabase();

  const user = await User.findOne({ phoneNumber: normalizedPhone })
    .select({ _id: 1 })
    .lean<{ _id: string } | null>()
    .exec();

  if (!user?._id) return;

  await CallLog.findOneAndUpdate(
    { userId: user._id },
    { $set: { summary: input.summary.trim() } },
    {
      sort: { createdAt: -1 },
      returnDocument: "after",
    }
  ).exec();

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        lastCallSummary: input.summary.trim(),
        lastSeenAt: new Date(),
      },
    }
  ).exec();
}

export async function queueCallSummaryRetry(input: {
  callSid?: string;
  phoneNumber?: string;
  transcriptPreview: string;
  summaryErrorReason?: string | null;
  delaySeconds?: number;
}) {
  const callSid = String(input.callSid ?? "").trim();
  const normalizedPhone = normalizePhoneNumber(String(input.phoneNumber ?? ""));
  const transcriptPreview = String(input.transcriptPreview ?? "").trim();
  if (!transcriptPreview || (!callSid && !normalizedPhone)) return;

  await connectToDatabase();
  const scheduledAt = new Date(Date.now() + Math.max(15, Math.floor(input.delaySeconds ?? 120)) * 1000);
  const retryPayload = {
    summaryRetryNeeded: true,
    summaryRetryScheduledAt: scheduledAt,
    summaryTranscriptPreview: transcriptPreview,
    summaryRetryLastError: input.summaryErrorReason?.trim() || "summary_generation_failed",
  };

  if (callSid) {
    await CallLog.updateOne({ callSid }, { $set: retryPayload }).exec();
    return;
  }

  const user = await User.findOne({ phoneNumber: normalizedPhone })
    .select({ _id: 1 })
    .lean<{ _id: string } | null>()
    .exec();
  if (!user?._id) return;

  await CallLog.findOneAndUpdate(
    { userId: user._id },
    { $set: retryPayload },
    {
      sort: { createdAt: -1 },
      returnDocument: "after",
    }
  ).exec();
}

export type RecentAnonymousCaller = {
  label: string;
  highlight: string;
  lastCallAtIso: string;
};

export type PaidCallHistoryItem = {
  summary: string;
  durationSeconds: number;
  createdAtIso: string;
  phoneLabel: string;
};

export async function getPaidCallHistoryForWalletUser(
  walletUserId: string,
  limit = 5
): Promise<PaidCallHistoryItem[]> {
  const normalizedWalletUserId = String(walletUserId ?? "").trim();
  if (!normalizedWalletUserId) return [];

  await connectToDatabase();
  const user = await User.findOne({ walletUserId: normalizedWalletUserId })
    .select({ _id: 1, phoneNumber: 1 })
    .lean<{ _id: string; phoneNumber?: string | null } | null>()
    .exec();
  if (!user?._id) return [];
  const phoneLabel = user.phoneNumber ? maskPhoneNumber(user.phoneNumber) : "***-***-****";

  const rows = await CallLog.find({ userId: user._id, billingMode: "paid" })
    .sort({ createdAt: -1 })
    .limit(Math.max(1, limit))
    .select({ summary: 1, durationSeconds: 1, createdAt: 1 })
    .lean<Array<{ summary?: string; durationSeconds?: number; createdAt?: Date | string }>>()
    .exec();

  return rows.map((row) => ({
    summary: diversifySummaryLead(
      sanitizePublicSummary(String(row.summary ?? "Voice call with Carlos AI")),
      String(row.createdAt ?? "")
    ),
    durationSeconds: Math.max(0, Math.floor(Number(row.durationSeconds ?? 0))),
    createdAtIso: new Date(row.createdAt ?? Date.now()).toISOString(),
    phoneLabel,
  }));
}

export async function getRecentAnonymousCallers(limit = 5): Promise<RecentAnonymousCaller[]> {
  await connectToDatabase();

  const rows = await CallLog.aggregate<{
    phoneNumber: string;
    summary: string;
    callSid: string | null;
    lastCallAt: Date;
  }>([
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $group: {
        _id: "$user.phoneNumber",
        summary: { $first: "$summary" },
        callSid: { $first: "$callSid" },
        lastCallAt: { $first: "$createdAt" },
      },
    },
    { $sort: { lastCallAt: -1 } },
    { $limit: Math.max(1, limit) },
    {
      $project: {
        _id: 0,
        phoneNumber: "$_id",
        summary: 1,
        callSid: 1,
        lastCallAt: 1,
      },
    },
  ]).exec();

  const activeCallerRows = await CallReservation.find({
    callerPhone: { $type: "string", $ne: "" },
  })
    .select({ callerPhone: 1, callSid: 1, createdAt: 1, maxDurationSeconds: 1, _id: 0 })
    .lean<
      Array<{
        callerPhone?: string | null;
        callSid?: string | null;
        createdAt?: Date | string | null;
        maxDurationSeconds?: number | null;
      }>
    >()
    .exec();

  const nowMs = Date.now();
  const activeByPhone = new Map<
    string,
    { createdAtMs: number; maxDurationSeconds: number }
  >();
  const activeCallSids = new Set<string>();

  for (const row of activeCallerRows) {
    const callSid = typeof row.callSid === "string" ? row.callSid.trim() : "";
    if (callSid) activeCallSids.add(callSid);

    const phone = normalizePhoneNumber(row.callerPhone ?? "");
    if (!phone) continue;

    const createdAtMs = row.createdAt ? new Date(row.createdAt).getTime() : Number.NaN;
    if (!Number.isFinite(createdAtMs)) continue;

    const maxDurationSeconds = Math.max(1, Math.floor(row.maxDurationSeconds ?? 60));
    const staleAfterMs = createdAtMs + (maxDurationSeconds + 120) * 1000;
    if (nowMs > staleAfterMs) continue;

    const prev = activeByPhone.get(phone);
    if (!prev || createdAtMs > prev.createdAtMs) {
      activeByPhone.set(phone, { createdAtMs, maxDurationSeconds });
    }
  }

  return rows.map((row) => ({
    // Keep "on the call" only while reservation is active and no newer completed summary exists yet.
    ...(function resolveHighlight() {
      const rowCallSid = typeof row.callSid === "string" ? row.callSid.trim() : "";
      if (rowCallSid && activeCallSids.has(rowCallSid)) {
        return { highlight: "on the call" };
      }

      const normalizedRowPhone = normalizePhoneNumber(row.phoneNumber);
      const active = normalizedRowPhone ? activeByPhone.get(normalizedRowPhone) : undefined;
      const rowLastCallMs = new Date(row.lastCallAt).getTime();
      const isOnCall = Boolean(
        active && Number.isFinite(rowLastCallMs) && rowLastCallMs < active.createdAtMs
      );
      return {
        highlight: isOnCall
          ? "on the call"
          : diversifySummaryLead(
              sanitizePublicSummary(row.summary || "Voice call with Carlos AI"),
              `${row.phoneNumber}:${new Date(row.lastCallAt).toISOString()}`
            ),
      };
    })(),
    label: maskPhoneNumber(row.phoneNumber),
    lastCallAtIso: row.lastCallAt.toISOString(),
  }));
}
