import { registerElevenLabsCall } from "@/lib/agentchat/elevenlabs";
import {
  DISABLE_FREE_CALLS,
  EFFECTIVE_FREE_CALL_DAILY_POOL_SECONDS,
  FREE_CALL_LIMIT_SECONDS,
  FREE_CALL_MINUTES,
} from "@/lib/agentchat/config";
import { resolveMemoryModeForCall } from "@/lib/agentchat/memory-mode";
import { releaseCallReservation, reserveFreeDailyCall } from "@/lib/agentchat/store";
import { getTwilioStreamStatusCallbackUrl } from "@/lib/agentchat/twilio-rest";
import { attachStreamStatusCallback, enforceDialTimeLimit, twiml, twimlTextResponse } from "@/lib/agentchat/twilio";

function pinPromptTwiml(message?: string): string {
  const intro =
    message ??
    (DISABLE_FREE_CALLS
      ? "Welcome. Free calls are currently unavailable."
      : `Welcome. Free calls are available each day across all callers, up to ${FREE_CALL_MINUTES} minute each.`);

  return twiml(`
    <Say voice="alice">Enter your six digit access code</Say>
    <Gather numDigits="6" action="/api/call/twilio/verify-pin" method="POST" timeout="8" />
    <Say voice="alice">No code received. Bye.</Say>
    <Hangup />
  `);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const callSid = String(form.get("CallSid") ?? "").trim();
  const from = String(form.get("From") ?? "").trim();
  const to = String(form.get("To") ?? "").trim();

  if (!callSid || !from || !to) {
    return twimlTextResponse(twiml("<Say>Invalid request.</Say><Hangup />"));
  }

  if (DISABLE_FREE_CALLS) {
    return twimlTextResponse(pinPromptTwiml("Free calls are currently unavailable."));
  }

  const freeReservation = await reserveFreeDailyCall(
    `phone:${from}`,
    callSid,
    from,
    FREE_CALL_MINUTES,
    FREE_CALL_LIMIT_SECONDS,
    EFFECTIVE_FREE_CALL_DAILY_POOL_SECONDS
  );

  if (!freeReservation.ok) {
    return twimlTextResponse(
      pinPromptTwiml(
        "Today's free pool is used up."
      )
    );
  }

  const freeLimitSeconds = freeReservation.maxDurationSeconds;

  try {
    const memoryMode = await resolveMemoryModeForCall({ callerPhone: from });
    const elevenLabsTwimlRaw = await registerElevenLabsCall({
      fromNumber: from,
      toNumber: to,
      callSid,
      direction: "inbound",
      maxDurationSeconds: freeLimitSeconds,
      memoryMode,
    });
    const elevenLabsTwimlWithCallback = attachStreamStatusCallback(
      elevenLabsTwimlRaw,
      getTwilioStreamStatusCallbackUrl()
    );
    const elevenLabsTwiml = enforceDialTimeLimit(elevenLabsTwimlWithCallback, freeLimitSeconds);
    return twimlTextResponse(elevenLabsTwiml);
  } catch (error) {
    console.error("Incoming free-call register failed", error);
    await releaseCallReservation(callSid);
    return twimlTextResponse(
      pinPromptTwiml("We could not place the free call right now.")
    );
  }
}
