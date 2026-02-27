import twilio, { Twilio } from "twilio";

import {
  SITE_URL,
  TWILIO_ACCOUNT_SID,
  TWILIO_API_KEY_SECRET,
  TWILIO_API_KEY_SID,
} from "@/lib/agentchat/config";

const globalTwilio = globalThis as unknown as {
  __twilioRestClient?: Twilio;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNotInProgressError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: number; message?: string };
  if (maybe.code === 21220) return true;
  return (maybe.message ?? "").toLowerCase().includes("not in-progress");
}

function getTwilioClient(): Twilio | null {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET) {
    console.error("Twilio hard limit unavailable: missing TWILIO_ACCOUNT_SID/TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET");
    return null;
  }

  if (!globalTwilio.__twilioRestClient) {
    globalTwilio.__twilioRestClient = twilio(TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, {
      accountSid: TWILIO_ACCOUNT_SID,
    });
  }

  return globalTwilio.__twilioRestClient;
}

function buildCallbackUrl(path: string): string | null {
  if (!SITE_URL) return null;
  try {
    return new URL(path, SITE_URL).toString();
  } catch {
    return null;
  }
}

export function getTwilioCompletionCallbackUrl(): string | null {
  return buildCallbackUrl("/api/call/twilio/complete");
}

export function getTwilioStreamStatusCallbackUrl(): string | null {
  return buildCallbackUrl("/api/call/twilio/stream-status");
}

export async function applyTwilioHardCallLimit(
  callSid: string,
  maxDurationSeconds: number,
  graceSeconds: number = 0
): Promise<boolean> {
  const client = getTwilioClient();
  if (!client || !callSid) {
    return false;
  }

  const clamped = Math.max(1, Math.floor(maxDurationSeconds));
  const safeGraceSeconds = Math.max(0, Math.floor(graceSeconds));
  const statusCallback = getTwilioCompletionCallbackUrl();

  const updatePayload = {
    // Twilio applies call-level timeLimit against total call age.
    // Keep only a very small grace to avoid ending a second early.
    timeLimit: clamped + safeGraceSeconds,
    ...(statusCallback
      ? {
          statusCallback,
          statusCallbackMethod: "POST" as const,
        }
      : {}),
  };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await client.calls(callSid).update(updatePayload);
      return true;
    } catch (error) {
      if (!isNotInProgressError(error)) {
        console.error("Twilio hard limit update failed", { callSid, clamped, attempt, error });
        return false;
      }

      if (attempt === 5) {
        console.error("Twilio hard limit update timed out waiting for in-progress call", {
          callSid,
          clamped,
          error,
        });
        return false;
      }

      await sleep(300);
    }
  }

  return false;
}

export async function completeTwilioCall(callSid: string): Promise<boolean> {
  const client = getTwilioClient();
  if (!client || !callSid) {
    return false;
  }

  try {
    await client.calls(callSid).update({ status: "completed" });
    return true;
  } catch (error) {
    console.error("Twilio call completion failed", { callSid, error });
    return false;
  }
}

export type TwilioCallSnapshot = {
  sid: string;
  parentCallSid: string | null;
  from: string | null;
  status: string | null;
  durationSeconds: number;
};

export async function fetchTwilioCallSnapshot(callSid: string): Promise<TwilioCallSnapshot | null> {
  const client = getTwilioClient();
  if (!client || !callSid) {
    return null;
  }

  try {
    const call = await client.calls(callSid).fetch();
    const parsedDuration = Number(call.duration ?? 0);
    return {
      sid: call.sid,
      parentCallSid: call.parentCallSid ?? null,
      from: call.from ?? null,
      status: call.status ?? null,
      durationSeconds: Number.isFinite(parsedDuration) && parsedDuration > 0 ? Math.floor(parsedDuration) : 0,
    };
  } catch (error) {
    console.error("Twilio call fetch failed", { callSid, error });
    return null;
  }
}
