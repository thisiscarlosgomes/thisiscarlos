import { FREE_CALL_COUNT_MIN_SECONDS } from "@/lib/agentchat/config";
import { recordCallInteraction } from "@/lib/agentchat/call-log";
import { getCallReservation, settleCallReservation } from "@/lib/agentchat/store";
import { fetchTwilioCallSnapshot } from "@/lib/agentchat/twilio-rest";
import { twiml, twimlTextResponse } from "@/lib/agentchat/twilio";

function readDurationSeconds(form: FormData): number {
  const candidates = ["DialCallDuration", "CallDuration", "Duration"];
  for (const field of candidates) {
    const raw = Number(form.get(field) ?? 0);
    if (Number.isFinite(raw) && raw > 0) {
      return raw;
    }
  }
  return 0;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const callSid = String(form.get("CallSid") ?? "").trim();
  const parentCallSid = String(form.get("ParentCallSid") ?? "").trim();
  const fromRaw = String(form.get("From") ?? "").trim();
  let durationSeconds = readDurationSeconds(form);
  const sidCandidates = [callSid, parentCallSid].filter(Boolean);

  if (durationSeconds <= 0) {
    for (const sid of sidCandidates) {
      const snapshot = await fetchTwilioCallSnapshot(sid);
      if (snapshot && snapshot.durationSeconds > 0) {
        durationSeconds = snapshot.durationSeconds;
        break;
      }
    }
  }

  if (sidCandidates.length > 0) {
    let existingReservation = null as Awaited<ReturnType<typeof getCallReservation>>;
    for (const sid of sidCandidates) {
      existingReservation = await getCallReservation(sid);
      if (existingReservation) break;
    }

    let settle = null as Awaited<ReturnType<typeof settleCallReservation>>;
    let settledSid = "";
    for (const sid of sidCandidates) {
      settle = await settleCallReservation(sid, durationSeconds, FREE_CALL_COUNT_MIN_SECONDS);
      if (settle) {
        settledSid = sid;
        break;
      }
    }

    let callerPhone = fromRaw || settle?.callerPhone || existingReservation?.callerPhone;
    if (!callerPhone) {
      for (const sid of sidCandidates) {
        const snapshot = await fetchTwilioCallSnapshot(sid);
        if (snapshot?.from) {
          callerPhone = snapshot.from;
          break;
        }
      }
    }
    const sidForLog = settledSid || existingReservation?.callSid || sidCandidates[0];
    const effectiveDurationSeconds = Math.max(
      0,
      settle?.usedSeconds ?? Math.floor(durationSeconds)
    );

    // Treat calls above threshold as a real AI interaction and persist for analytics/history.
    if (callerPhone && effectiveDurationSeconds >= FREE_CALL_COUNT_MIN_SECONDS) {
      await recordCallInteraction({
        phoneNumber: callerPhone,
        callSid: sidForLog,
        durationSeconds: effectiveDurationSeconds,
        billingMode: existingReservation?.billingMode ?? "unknown",
      });
    }
  }

  return twimlTextResponse(twiml("<Hangup />"));
}
