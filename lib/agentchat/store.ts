import { connectToDatabase } from "@/lib/db";
import { CREDITS_PER_MINUTE, FREE_CALL_COUNT_MIN_SECONDS } from "@/lib/agentchat/config";
import { fetchTwilioCallSnapshot } from "@/lib/agentchat/twilio-rest";
import { AgentWallet } from "@/models/AgentWallet";
import { CallReservation } from "@/models/CallReservation";
import { FreeCallUsage } from "@/models/FreeCallUsage";

type Reservation = {
  callSid: string;
  userId: string;
  callerPhone?: string;
  reservedMinutes: number;
  reservedCredits: number;
  maxDurationSeconds: number;
  billingMode: "paid" | "free-daily";
  freeDateKey?: string;
  billableStartedAt?: Date;
};

export type MemoryMode = "casual" | "coach" | "builder";

export type FreeCallStatus = {
  dateKey: string;
  confirmedCount: number;
  inFlightCount: number;
  confirmedSeconds: number;
  inFlightReservedSeconds: number;
  remainingPoolSeconds: number;
  maxPerCallSeconds: number;
  equivalentCallLimit: number;
  remainingCount: number;
  dailyLimit: number;
  resetsAtIso: string;
};

export type CallMoment = {
  summary: string;
  durationSeconds: number;
  endedAtIso: string;
};

type AgentStore = {
  processedStripeEvents: Set<string>;
  callMoments: Map<string, CallMoment>;
};

const globalStore = globalThis as unknown as {
  __agentStore?: AgentStore;
};

function createStore(): AgentStore {
  return {
    processedStripeEvents: new Set(),
    callMoments: new Map(),
  };
}

function store(): AgentStore {
  if (!globalStore.__agentStore) {
    globalStore.__agentStore = createStore();
  } else {
    // Backfill new in-memory fields across hot reloads/runtime upgrades.
    globalStore.__agentStore.callMoments ??= new Map();
    globalStore.__agentStore.processedStripeEvents ??= new Set();
  }
  return globalStore.__agentStore;
}

function randomPin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === 11000;
}

function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function getExistingReservation(callSid: string): Promise<Reservation | null> {
  await connectToDatabase();
  const reservation = await CallReservation.findOne({ callSid })
    .lean<{
      callSid: string;
      userId: string;
      callerPhone: string | null;
      reservedMinutes: number;
      reservedCredits: number;
      maxDurationSeconds: number;
      billingMode: "paid" | "free-daily";
      freeDateKey: string | null;
      billableStartedAt: Date | string | null;
    } | null>()
    .exec();

  if (!reservation) return null;
  return {
    callSid: reservation.callSid,
    userId: reservation.userId,
    callerPhone: reservation.callerPhone ?? undefined,
    reservedMinutes: reservation.reservedMinutes,
    reservedCredits: Math.max(0, reservation.reservedCredits ?? 0),
    maxDurationSeconds: reservation.maxDurationSeconds,
    billingMode: reservation.billingMode,
    freeDateKey: reservation.freeDateKey ?? undefined,
    billableStartedAt: reservation.billableStartedAt
      ? new Date(String(reservation.billableStartedAt))
      : undefined,
  };
}

export async function getCallReservation(callSid: string): Promise<Reservation | null> {
  return getExistingReservation(callSid);
}

export async function markCallReservationBillableStarted(
  callSid: string,
  startedAt: Date = new Date()
): Promise<boolean> {
  if (!callSid) return false;
  await connectToDatabase();
  const result = await CallReservation.updateOne(
    { callSid, billableStartedAt: null },
    { $set: { billableStartedAt: startedAt } }
  ).exec();
  return result.modifiedCount > 0;
}

async function tryReserveFreeDailyCall(
  userId: string,
  callSid: string,
  callerPhone: string,
  freeCallMinutes: number,
  freeCallLimitSeconds: number,
  freeDailyPoolSeconds: number
): Promise<
  | {
      ok: true;
      balance: number;
      billingMode: "free-daily";
      reservedMinutes: number;
      reservedCredits: number;
      maxDurationSeconds: number;
    }
  | { ok: false }
> {
  const existing = await getExistingReservation(callSid);
  if (existing && existing.billingMode === "free-daily") {
    return {
      ok: true,
      balance: await getCredits(existing.userId),
      billingMode: "free-daily",
      reservedMinutes: existing.reservedMinutes,
      reservedCredits: existing.reservedCredits,
      maxDurationSeconds: existing.maxDurationSeconds,
    };
  }

  if (freeDailyPoolSeconds <= 0) {
    return { ok: false };
  }

  await connectToDatabase();
  const freeDateKey = utcDateKey(new Date());
  await FreeCallUsage.updateOne(
    { dateKey: freeDateKey },
    {
      $setOnInsert: {
        dateKey: freeDateKey,
        confirmedCount: 0,
        inFlightCount: 0,
        confirmedSeconds: 0,
        inFlightReservedSeconds: 0,
      },
    },
    { upsert: true }
  ).exec();

  const usageSnapshot = await FreeCallUsage.findOne({ dateKey: freeDateKey })
    .lean<{
      confirmedSeconds?: number;
      inFlightReservedSeconds?: number;
    } | null>()
    .exec();

  const confirmedSeconds = Math.max(0, usageSnapshot?.confirmedSeconds ?? 0);
  const inFlightReservedSeconds = Math.max(0, usageSnapshot?.inFlightReservedSeconds ?? 0);
  const remainingPoolSeconds = Math.max(
    0,
    Math.floor(freeDailyPoolSeconds - (confirmedSeconds + inFlightReservedSeconds))
  );
  const minReservableSeconds = Math.max(1, FREE_CALL_COUNT_MIN_SECONDS);
  if (remainingPoolSeconds < minReservableSeconds) {
    return { ok: false };
  }

  const reservedSeconds = Math.min(Math.max(1, Math.floor(freeCallLimitSeconds)), remainingPoolSeconds);

  if (reservedSeconds <= 0) {
    return { ok: false };
  }

  const usage = await FreeCallUsage.findOneAndUpdate(
    {
      dateKey: freeDateKey,
      $expr: {
        $lte: [{ $add: ["$confirmedSeconds", "$inFlightReservedSeconds", reservedSeconds] }, freeDailyPoolSeconds],
      },
    },
    { $inc: { inFlightCount: 1, inFlightReservedSeconds: reservedSeconds } },
    { returnDocument: "after" }
  ).exec();

  if (!usage) {
    return { ok: false };
  }

  const maxDurationSeconds = reservedSeconds;
  const reservedMinutes = Math.max(1, Math.ceil(maxDurationSeconds / 60));

  try {
    await CallReservation.create({
      callSid,
      userId,
      callerPhone,
      reservedMinutes,
      reservedCredits: 0,
      maxDurationSeconds,
      billingMode: "free-daily",
      freeDateKey,
      billableStartedAt: null,
    });
  } catch {
    await FreeCallUsage.updateOne(
      { dateKey: freeDateKey },
      { $inc: { inFlightCount: -1, inFlightReservedSeconds: -reservedSeconds } }
    ).exec();

    const retry = await getExistingReservation(callSid);
    if (retry && retry.billingMode === "free-daily") {
      return {
        ok: true,
        balance: await getCredits(retry.userId),
        billingMode: "free-daily",
        reservedMinutes: retry.reservedMinutes,
        reservedCredits: retry.reservedCredits,
        maxDurationSeconds: retry.maxDurationSeconds,
      };
    }

    return { ok: false };
  }

  return {
    ok: true,
    balance: await getCredits(userId),
    billingMode: "free-daily",
    reservedMinutes,
    reservedCredits: 0,
    maxDurationSeconds,
  };
}

async function ensureWallet(userId: string): Promise<{
  userId: string;
  pin: string;
  credits: number;
  memoryMode: MemoryMode;
}> {
  await connectToDatabase();

  const existing = await AgentWallet.findOne({ userId })
    .select({ userId: 1, pin: 1, credits: 1, memoryMode: 1 })
    .lean<{ userId: string; pin: string; credits: number; memoryMode?: MemoryMode } | null>()
    .exec();

  if (existing) {
    return {
      userId: existing.userId,
      pin: existing.pin,
      credits: Math.max(0, existing.credits ?? 0),
      memoryMode: existing.memoryMode ?? "casual",
    };
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const created = await AgentWallet.create({
        userId,
        pin: randomPin(),
        credits: 0,
        memoryMode: "casual",
      });
      return {
        userId: created.userId,
        pin: created.pin,
        credits: Math.max(0, created.credits ?? 0),
        memoryMode: created.memoryMode ?? "casual",
      };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }

  const retry = await AgentWallet.findOne({ userId })
    .select({ userId: 1, pin: 1, credits: 1, memoryMode: 1 })
    .lean<{ userId: string; pin: string; credits: number; memoryMode?: MemoryMode } | null>()
    .exec();
  if (!retry) {
    throw new Error("Could not initialize wallet");
  }

  return {
    userId: retry.userId,
    pin: retry.pin,
    credits: Math.max(0, retry.credits ?? 0),
    memoryMode: retry.memoryMode ?? "casual",
  };
}

export async function ensureUser(userId: string): Promise<{ userId: string; pin: string }> {
  const wallet = await ensureWallet(userId);
  return { userId: wallet.userId, pin: wallet.pin };
}

export async function getUserFromPin(pin: string): Promise<string | null> {
  if (!pin) return null;
  await connectToDatabase();
  const wallet = await AgentWallet.findOne({ pin })
    .select({ userId: 1 })
    .lean<{ userId: string } | null>()
    .exec();
  return wallet?.userId ?? null;
}

export async function getCredits(userId: string): Promise<number> {
  await connectToDatabase();
  const wallet = await AgentWallet.findOne({ userId })
    .select({ credits: 1 })
    .lean<{ credits: number } | null>()
    .exec();
  return Math.max(0, wallet?.credits ?? 0);
}

export async function getMemoryMode(userId: string): Promise<MemoryMode> {
  await ensureWallet(userId);
  await connectToDatabase();
  const wallet = await AgentWallet.findOne({ userId })
    .select({ memoryMode: 1 })
    .lean<{ memoryMode?: MemoryMode } | null>()
    .exec();
  return wallet?.memoryMode ?? "casual";
}

export async function setMemoryMode(userId: string, mode: MemoryMode): Promise<MemoryMode> {
  await ensureWallet(userId);
  await connectToDatabase();
  const updated = await AgentWallet.findOneAndUpdate(
    { userId },
    { $set: { memoryMode: mode } },
    { returnDocument: "after" }
  )
    .select({ memoryMode: 1 })
    .lean<{ memoryMode?: MemoryMode } | null>()
    .exec();
  return updated?.memoryMode ?? mode;
}

export async function addCredits(userId: string, amount: number): Promise<number> {
  await ensureWallet(userId);
  await connectToDatabase();
  const delta = Math.floor(Number(amount));
  if (!Number.isFinite(delta) || delta === 0) {
    const current = await AgentWallet.findOne({ userId })
      .select({ credits: 1 })
      .lean<{ credits: number } | null>()
      .exec();
    return Math.max(0, current?.credits ?? 0);
  }

  if (delta > 0) {
    const updated = await AgentWallet.findOneAndUpdate(
      { userId },
      { $inc: { credits: delta } },
      { returnDocument: "after" }
    )
      .select({ credits: 1 })
      .lean<{ credits: number } | null>()
      .exec();
    return Math.max(0, updated?.credits ?? 0);
  }

  const abs = Math.abs(delta);
  const updated = await AgentWallet.findOneAndUpdate(
    { userId, credits: { $gte: abs } },
    { $inc: { credits: -abs } },
    { returnDocument: "after" }
  )
    .select({ credits: 1 })
    .lean<{ credits: number } | null>()
    .exec();

  if (updated) {
    return Math.max(0, updated.credits ?? 0);
  }

  const clamped = await AgentWallet.findOneAndUpdate(
    { userId },
    { $set: { credits: 0 } },
    { returnDocument: "after" }
  )
    .select({ credits: 1 })
    .lean<{ credits: number } | null>()
    .exec();

  return Math.max(0, clamped?.credits ?? 0);
}

function formatCallMomentSummary(
  billingMode: "paid" | "free-daily",
  durationSeconds: number
): string {
  const safeSeconds = Math.max(0, Math.floor(durationSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  const modeLabel = billingMode === "free-daily" ? "free" : "paid";

  if (minutes > 0) {
    return `You had a ${minutes}m ${seconds}s ${modeLabel} call with Carlos AI.`;
  }
  return `You had a ${seconds}s ${modeLabel} call with Carlos AI.`;
}

export function getLastCallMoment(userId: string): CallMoment | null {
  return store().callMoments.get(userId) ?? null;
}

export async function reserveCreditsForCall(
  userId: string,
  callSid: string,
  callerPhone: string,
  maxPaidMinutes: number,
  freeCallMinutes: number,
  freeCallLimitSeconds: number,
  freeDailyPoolSeconds: number
): Promise<
  | {
      ok: true;
      balance: number;
      billingMode: "paid" | "free-daily";
      reservedMinutes: number;
      reservedCredits: number;
      maxDurationSeconds: number;
    }
  | { ok: false; balance: number }
> {
  const existing = await getExistingReservation(callSid);
  if (existing) {
    return {
      ok: true,
      balance: await getCredits(existing.userId),
      billingMode: existing.billingMode,
      reservedMinutes: existing.reservedMinutes,
      reservedCredits: existing.reservedCredits,
      maxDurationSeconds: existing.maxDurationSeconds,
    };
  }

  const freeReservation = await tryReserveFreeDailyCall(
    userId,
    callSid,
    callerPhone,
    freeCallMinutes,
    freeCallLimitSeconds,
    freeDailyPoolSeconds
  );
  if (freeReservation.ok) {
    return freeReservation;
  }

  const current = await getCredits(userId);
  const affordableSeconds = Math.floor((Math.max(0, current) * 60) / CREDITS_PER_MINUTE);
  const paidReservedSeconds =
    maxPaidMinutes > 0
      ? Math.min(maxPaidMinutes * 60, affordableSeconds)
      : affordableSeconds;

  if (paidReservedSeconds <= 0) {
    return { ok: false, balance: current };
  }

  const paidReservedCredits = Math.ceil((paidReservedSeconds * CREDITS_PER_MINUTE) / 60);
  const paidReservedMinutes = Math.max(1, Math.ceil(paidReservedSeconds / 60));
  await addCredits(userId, -paidReservedCredits);

  try {
    const maxDurationSeconds = paidReservedSeconds;
    await connectToDatabase();
    await CallReservation.create({
      callSid,
      userId,
      callerPhone,
      reservedMinutes: paidReservedMinutes,
      reservedCredits: paidReservedCredits,
      maxDurationSeconds,
      billingMode: "paid",
      freeDateKey: null,
      billableStartedAt: null,
    });
  } catch {
    await addCredits(userId, paidReservedCredits);
    const retry = await getExistingReservation(callSid);
    if (retry) {
      return {
        ok: true,
        balance: await getCredits(retry.userId),
        billingMode: retry.billingMode,
        reservedMinutes: retry.reservedMinutes,
        reservedCredits: retry.reservedCredits,
        maxDurationSeconds: retry.maxDurationSeconds,
      };
    }
    return { ok: false, balance: await getCredits(userId) };
  }

  return {
    ok: true,
    balance: await getCredits(userId),
    billingMode: "paid",
    reservedMinutes: paidReservedMinutes,
    reservedCredits: paidReservedCredits,
    maxDurationSeconds: paidReservedSeconds,
  };
}

export async function reserveFreeDailyCall(
  userId: string,
  callSid: string,
  callerPhone: string,
  freeCallMinutes: number,
  freeCallLimitSeconds: number,
  freeDailyPoolSeconds: number
): Promise<
  | {
      ok: true;
      balance: number;
      billingMode: "free-daily";
      reservedMinutes: number;
      reservedCredits: number;
      maxDurationSeconds: number;
    }
  | { ok: false }
> {
  return tryReserveFreeDailyCall(
    userId,
    callSid,
    callerPhone,
    freeCallMinutes,
    freeCallLimitSeconds,
    freeDailyPoolSeconds
  );
}

export async function reserveTestFreeCall(
  userId: string,
  callSid: string,
  callerPhone: string,
  maxDurationSeconds: number
): Promise<
  | {
      ok: true;
      balance: number;
      billingMode: "paid" | "free-daily";
      reservedMinutes: number;
      reservedCredits: number;
      maxDurationSeconds: number;
    }
  | { ok: false; balance: number }
> {
  const existing = await getExistingReservation(callSid);
  if (existing) {
    return {
      ok: true,
      balance: await getCredits(existing.userId),
      billingMode: existing.billingMode,
      reservedMinutes: existing.reservedMinutes,
      reservedCredits: existing.reservedCredits,
      maxDurationSeconds: existing.maxDurationSeconds,
    };
  }

  const clampedSeconds = Math.max(1, Math.floor(maxDurationSeconds));
  const reservedMinutes = Math.max(1, Math.ceil(clampedSeconds / 60));

  try {
    await connectToDatabase();
    await CallReservation.create({
      callSid,
      userId,
      callerPhone,
      reservedMinutes,
      reservedCredits: 0,
      maxDurationSeconds: clampedSeconds,
      billingMode: "paid",
      freeDateKey: null,
      billableStartedAt: null,
    });
  } catch {
    const retry = await getExistingReservation(callSid);
    if (retry) {
      return {
        ok: true,
        balance: await getCredits(retry.userId),
        billingMode: retry.billingMode,
        reservedMinutes: retry.reservedMinutes,
        reservedCredits: retry.reservedCredits,
        maxDurationSeconds: retry.maxDurationSeconds,
      };
    }
    return { ok: false, balance: await getCredits(userId) };
  }

  return {
    ok: true,
    balance: await getCredits(userId),
    billingMode: "paid",
    reservedMinutes,
    reservedCredits: 0,
    maxDurationSeconds: clampedSeconds,
  };
}

export async function getFreeCallStatus(
  freeDailyPoolSeconds: number,
  freeCallLimitSeconds: number,
  now: Date = new Date()
): Promise<FreeCallStatus> {
  await connectToDatabase();

  // Reconcile ended calls that may not have settled yet, so UI status updates quickly after hangup.
  const inFlightReservations = await CallReservation.find({ billingMode: "free-daily" })
    .select({ callSid: 1, createdAt: 1, maxDurationSeconds: 1 })
    .lean<
      Array<{
        callSid?: string | null;
        createdAt?: Date | string | null;
        maxDurationSeconds?: number | null;
      }>
    >()
    .exec();

  const settledStatuses = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);

  for (const reservation of inFlightReservations) {
    const callSid = String(reservation.callSid ?? "").trim();
    if (!callSid) continue;

    const snapshot = await fetchTwilioCallSnapshot(callSid);
    const status = String(snapshot?.status ?? "").toLowerCase();
    const isEnded = settledStatuses.has(status);

    const createdAtMs = new Date(String(reservation.createdAt ?? 0)).getTime();
    const maxDurationSeconds = Math.max(1, Math.floor(Number(reservation.maxDurationSeconds ?? 0)));
    const hardTimeoutMs = createdAtMs + (maxDurationSeconds + 45) * 1000;
    const isTimedOut =
      Number.isFinite(createdAtMs) &&
      createdAtMs > 0 &&
      now.getTime() >= hardTimeoutMs;

    if (!isEnded && !isTimedOut) {
      continue;
    }

    const durationSeconds = Math.max(0, Number(snapshot?.durationSeconds ?? 0));
    const settled = await settleCallReservation(callSid, durationSeconds, FREE_CALL_COUNT_MIN_SECONDS);
    if (!settled) {
      await releaseCallReservation(callSid);
    }
  }

  const dailyPoolSeconds = Math.max(0, Math.floor(freeDailyPoolSeconds));
  const maxPerCallSeconds = Math.max(1, Math.floor(freeCallLimitSeconds));
  const equivalentCallLimit = Math.floor(dailyPoolSeconds / maxPerCallSeconds);
  const dateKey = utcDateKey(now);
  const usage = await FreeCallUsage.findOne({ dateKey })
    .lean<{
      confirmedCount?: number;
      inFlightCount?: number;
      confirmedSeconds?: number;
      inFlightReservedSeconds?: number;
    } | null>()
    .exec();

  const confirmedCount = Math.max(0, usage?.confirmedCount ?? 0);
  const inFlightCount = Math.max(0, usage?.inFlightCount ?? 0);
  const confirmedSeconds = Math.max(0, usage?.confirmedSeconds ?? 0);
  const inFlightReservedSeconds = Math.max(0, usage?.inFlightReservedSeconds ?? 0);
  const remainingPoolSeconds = Math.max(
    0,
    dailyPoolSeconds - (confirmedSeconds + inFlightReservedSeconds)
  );
  const minReservableSeconds = Math.max(1, FREE_CALL_COUNT_MIN_SECONDS);
  const effectiveRemainingPoolSeconds =
    remainingPoolSeconds < minReservableSeconds ? 0 : remainingPoolSeconds;
  const remainingCount =
    effectiveRemainingPoolSeconds > 0 ? Math.ceil(effectiveRemainingPoolSeconds / maxPerCallSeconds) : 0;

  const resetsAt = new Date(`${dateKey}T00:00:00.000Z`);
  resetsAt.setUTCDate(resetsAt.getUTCDate() + 1);

  return {
    dateKey,
    confirmedCount,
    inFlightCount,
    confirmedSeconds,
    inFlightReservedSeconds,
    remainingPoolSeconds: effectiveRemainingPoolSeconds,
    maxPerCallSeconds,
    equivalentCallLimit,
    remainingCount,
    dailyLimit: equivalentCallLimit,
    resetsAtIso: resetsAt.toISOString(),
  };
}

export async function settleCallReservation(
  callSid: string,
  callDurationSeconds: number,
  freeCallCountMinSeconds: number
): Promise<{
  userId: string;
  callerPhone?: string;
  usedSeconds: number;
  usedMinutes: number;
  refundedMinutes: number;
  balance: number;
} | null> {
  await connectToDatabase();
  const reservation = await CallReservation.findOneAndDelete({ callSid })
    .lean<{
      userId: string;
      callerPhone: string | null;
      reservedMinutes: number;
      reservedCredits: number;
      maxDurationSeconds: number;
      billingMode: "paid" | "free-daily";
      freeDateKey: string | null;
      createdAt?: Date | string | null;
      billableStartedAt?: Date | string | null;
    } | null>()
    .exec();

  if (!reservation) {
    return null;
  }

  const safeDuration = Math.max(0, callDurationSeconds);
  const rawUsedSeconds = Math.min(
    Math.max(0, reservation.maxDurationSeconds),
    Math.max(0, Math.floor(safeDuration))
  );
  // Paid billing starts only after stream-started callback confirms agent interaction started.
  const billableStartedAtMs = reservation.billableStartedAt
    ? new Date(String(reservation.billableStartedAt)).getTime()
    : NaN;
  const postBillableElapsedSeconds =
    Number.isFinite(billableStartedAtMs) && billableStartedAtMs > 0
      ? Math.max(0, Math.floor((Date.now() - billableStartedAtMs) / 1000))
      : 0;
  const usedSeconds =
    reservation.billingMode === "paid"
      ? Math.min(rawUsedSeconds, postBillableElapsedSeconds)
      : rawUsedSeconds;
  const usedMinutes = Math.min(reservation.reservedMinutes, Math.ceil(usedSeconds / 60));
  const usedCredits = Math.ceil((usedSeconds * CREDITS_PER_MINUTE) / 60);
  const reservedCredits = Math.max(
    0,
    reservation.billingMode === "paid"
      ? reservation.reservedCredits ?? reservation.reservedMinutes
      : 0
  );
  const refundedCredits =
    reservation.billingMode === "paid" ? Math.max(0, reservedCredits - usedCredits) : 0;

  if (refundedCredits > 0) {
    await addCredits(reservation.userId, refundedCredits);
  }

  if (reservation.billingMode === "free-daily" && reservation.freeDateKey) {
    const qualifiesAsCall = safeDuration >= Math.max(0, freeCallCountMinSeconds);
    const confirmedSeconds = qualifiesAsCall
      ? Math.min(Math.max(0, reservation.maxDurationSeconds), safeDuration)
      : 0;
    const incrementConfirmed = qualifiesAsCall ? { confirmedCount: 1, confirmedSeconds } : {};

    await FreeCallUsage.updateOne(
      { dateKey: reservation.freeDateKey },
      {
        $inc: {
          inFlightCount: -1,
          inFlightReservedSeconds: -Math.max(0, reservation.maxDurationSeconds),
          ...incrementConfirmed,
        },
      }
    ).exec();
  }

  const momentDurationSeconds =
    reservation.billingMode === "paid" ? usedSeconds : safeDuration;

  store().callMoments.set(reservation.userId, {
    summary: formatCallMomentSummary(reservation.billingMode, momentDurationSeconds),
    durationSeconds: momentDurationSeconds,
    endedAtIso: new Date().toISOString(),
  });

  return {
      userId: reservation.userId,
      callerPhone: reservation.callerPhone ?? undefined,
      usedSeconds,
      usedMinutes,
      refundedMinutes: Math.floor(refundedCredits / CREDITS_PER_MINUTE),
      balance: await getCredits(reservation.userId),
    };
}

export async function releaseCallReservation(callSid: string): Promise<{
  userId: string;
  refundedMinutes: number;
  balance: number;
} | null> {
  await connectToDatabase();
  const reservation = await CallReservation.findOneAndDelete({ callSid })
    .lean<{
      userId: string;
      reservedMinutes: number;
      reservedCredits: number;
      maxDurationSeconds: number;
      billingMode: "paid" | "free-daily";
      freeDateKey: string | null;
    } | null>()
    .exec();

  if (!reservation) {
    return null;
  }

  if (reservation.billingMode === "paid") {
    const refundCredits = Math.max(0, reservation.reservedCredits ?? reservation.reservedMinutes);
    await addCredits(reservation.userId, refundCredits);
  }

  if (reservation.billingMode === "free-daily" && reservation.freeDateKey) {
    await FreeCallUsage.updateOne(
      { dateKey: reservation.freeDateKey },
      { $inc: { inFlightCount: -1, inFlightReservedSeconds: -Math.max(0, reservation.maxDurationSeconds) } }
    ).exec();
  }

  return {
    userId: reservation.userId,
    refundedMinutes:
      reservation.billingMode === "paid"
        ? Math.floor(
            Math.max(0, reservation.reservedCredits ?? reservation.reservedMinutes) / CREDITS_PER_MINUTE
          )
        : 0,
    balance: await getCredits(reservation.userId),
  };
}

export function markStripeEventProcessed(eventId: string): boolean {
  const s = store();
  if (s.processedStripeEvents.has(eventId)) {
    return false;
  }
  s.processedStripeEvents.add(eventId);
  return true;
}
