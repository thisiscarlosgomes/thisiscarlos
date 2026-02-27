import { registerElevenLabsCall } from "@/lib/agentchat/elevenlabs";
import { linkPhoneToWalletUser } from "@/lib/agentchat/call-log";
import {
  FREE_CALL_LIMIT_SECONDS,
  FREE_CALL_MINUTES,
  MAX_PAID_CALL_MINUTES,
} from "@/lib/agentchat/config";
import {
  ensureUser,
  getUserFromPin,
  releaseCallReservation,
  reserveCreditsForCall,
  reserveTestFreeCall,
} from "@/lib/agentchat/store";
import { resolveMemoryModeForCall } from "@/lib/agentchat/memory-mode";
import { getTwilioStreamStatusCallbackUrl } from "@/lib/agentchat/twilio-rest";
import { attachStreamStatusCallback, enforceDialTimeLimit, twiml, twimlTextResponse } from "@/lib/agentchat/twilio";

function prependConfirmedPrompt(twimlXml: string): string {
  if (!twimlXml.includes("<Response")) return twimlXml;
  return twimlXml.replace("<Response>", '<Response><Say voice="alice">confirmed</Say>');
}

export async function POST(req: Request) {
  const form = await req.formData();
  const pin = String(form.get("Digits") ?? "").trim();
  const callSid = String(form.get("CallSid") ?? "").trim();
  const from = String(form.get("From") ?? "").trim();
  const to = String(form.get("To") ?? "").trim();

  if (!pin || !callSid || !from || !to) {
    return twimlTextResponse(twiml("<Say>Invalid request.</Say><Hangup />"));
  }

  const testFreePin = (process.env.TEST_FREE_PIN ?? "909090").trim();
  const isTestFreePin = pin === testFreePin;
  const testFreeUserId = (process.env.TEST_FREE_USER_ID ?? "test-free-caller").trim();
  const testFreeCallSeconds = Math.max(
    15,
    Number.parseInt(process.env.TEST_FREE_CALL_SECONDS ?? "120", 10) || 120
  );

  const userId = isTestFreePin
    ? (await ensureUser(testFreeUserId)).userId
    : await getUserFromPin(pin);
  if (!userId) {
    return twimlTextResponse(
      twiml("<Say>Invalid access code. Please try again later.</Say><Hangup />")
    );
  }

  if (!isTestFreePin) {
    await linkPhoneToWalletUser({ phoneNumber: from, walletUserId: userId });
  }

  const reserve = isTestFreePin
    ? await reserveTestFreeCall(userId, callSid, from, testFreeCallSeconds)
    : await reserveCreditsForCall(
        userId,
        callSid,
        from,
        MAX_PAID_CALL_MINUTES,
        FREE_CALL_MINUTES,
        FREE_CALL_LIMIT_SECONDS,
        0
      );
  if (!reserve.ok) {
    const outOfPaidMinutes = reserve.balance <= 0;
    return twimlTextResponse(
      twiml(
        outOfPaidMinutes
          ? "<Say>No paid minutes are available for this access code. Please buy more minutes and try again.</Say><Hangup />"
          : "<Say>We could not reserve your call minutes right now. Please try again in a moment.</Say><Hangup />"
      )
    );
  }

  try {
    const limitSeconds = reserve.maxDurationSeconds;
    const memoryMode = await resolveMemoryModeForCall({ callerPhone: from, userId });

    const elevenLabsTwimlRaw = await registerElevenLabsCall({
      fromNumber: from,
      toNumber: to,
      callSid,
      direction: "inbound",
      maxDurationSeconds: limitSeconds,
      memoryMode,
    });
    const elevenLabsTwimlWithCallback = attachStreamStatusCallback(
      elevenLabsTwimlRaw,
      getTwilioStreamStatusCallbackUrl()
    );
    const elevenLabsTwiml = enforceDialTimeLimit(elevenLabsTwimlWithCallback, limitSeconds);
    const confirmedTwiml = prependConfirmedPrompt(elevenLabsTwiml);
    return twimlTextResponse(confirmedTwiml);
  } catch (error) {
    console.error("Verify PIN register-call failed", error);
    await releaseCallReservation(callSid);
    return twimlTextResponse(
      twiml("<Say>Could not connect to the AI agent right now. Please try again.</Say><Hangup />")
    );
  }
}
