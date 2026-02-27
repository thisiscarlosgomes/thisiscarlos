import { FREE_CALL_COUNT_MIN_SECONDS } from "@/lib/agentchat/config";
import { recordCallInteraction } from "@/lib/agentchat/call-log";
import {
  getCallReservation,
  markCallReservationBillableStarted,
  settleCallReservation,
} from "@/lib/agentchat/store";
import {
  applyTwilioHardCallLimit,
  completeTwilioCall,
  fetchTwilioCallSnapshot,
} from "@/lib/agentchat/twilio-rest";

function readStreamDurationSeconds(form: FormData): number {
  const msCandidates = ["StreamDurationMs", "DurationMs"];
  for (const field of msCandidates) {
    const raw = Number(form.get(field) ?? 0);
    if (Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw / 1000);
    }
  }

  const secCandidates = ["CallDuration", "Duration"];
  for (const field of secCandidates) {
    const raw = Number(form.get(field) ?? 0);
    if (Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
  }

  return 0;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const callSid = String(form.get("CallSid") ?? "").trim();
  const parentCallSid = String(form.get("ParentCallSid") ?? "").trim();
  const effectiveCallSid = callSid || parentCallSid;
  const streamEvent = String(form.get("StreamEvent") ?? "").trim().toLowerCase();

  if (!effectiveCallSid) {
    return new Response(null, { status: 204 });
  }

  if (streamEvent === "stream-stopped" || streamEvent === "stream-error") {
    const sidCandidates = [effectiveCallSid, parentCallSid].filter(Boolean);
    let reservation = null as Awaited<ReturnType<typeof getCallReservation>>;
    for (const sid of sidCandidates) {
      reservation = await getCallReservation(sid);
      if (reservation) break;
    }

    let durationSeconds = readStreamDurationSeconds(form);
    if (durationSeconds <= 0) {
      for (const sid of sidCandidates) {
        const snapshot = await fetchTwilioCallSnapshot(sid);
        if (snapshot && snapshot.durationSeconds > 0) {
          durationSeconds = snapshot.durationSeconds;
          break;
        }
      }
    }
    let settledSid = "";
    let settledResult = null as Awaited<ReturnType<typeof settleCallReservation>>;

    for (const sid of sidCandidates) {
      const settled = await settleCallReservation(
        sid,
        durationSeconds,
        FREE_CALL_COUNT_MIN_SECONDS
      );
      if (settled) {
        settledSid = sid;
        settledResult = settled;
        break;
      }
    }

    let callerPhone = reservation?.callerPhone;
    if (!callerPhone) {
      for (const sid of sidCandidates) {
        const snapshot = await fetchTwilioCallSnapshot(sid);
        if (snapshot?.from) {
          callerPhone = snapshot.from;
          break;
        }
      }
    }

    const effectiveDurationSeconds = Math.max(
      0,
      settledResult?.usedSeconds ?? Math.floor(durationSeconds)
    );

    if (callerPhone && effectiveDurationSeconds >= FREE_CALL_COUNT_MIN_SECONDS) {
      await recordCallInteraction({
        phoneNumber: callerPhone,
        callSid: settledSid || reservation?.callSid || sidCandidates[0] || effectiveCallSid,
        durationSeconds: effectiveDurationSeconds,
        billingMode: reservation?.billingMode ?? "unknown",
      });
    }

    await completeTwilioCall(effectiveCallSid);
    return new Response(null, { status: 204 });
  }

  if (streamEvent !== "stream-started") {
    return new Response(null, { status: 204 });
  }

  const reservation =
    (await getCallReservation(effectiveCallSid)) ??
    (parentCallSid ? await getCallReservation(parentCallSid) : null);
  if (!reservation) {
    console.error("Stream started but reservation missing", {
      callSid,
      parentCallSid,
    });
    return new Response(null, { status: 204 });
  }

  await markCallReservationBillableStarted(reservation.callSid);

  const limitSeconds = reservation.maxDurationSeconds;
  const hardLimitGraceSeconds = 2;
  const applied = await applyTwilioHardCallLimit(
    effectiveCallSid,
    limitSeconds,
    hardLimitGraceSeconds
  );

  if (reservation.callerPhone) {
    await recordCallInteraction({
      phoneNumber: reservation.callerPhone,
      callSid: reservation.callSid,
      durationSeconds: 0,
      billingMode: reservation.billingMode ?? "unknown",
    });
  }

  if (!applied) {
    console.error("Failed to apply hard limit from stream-start callback", {
      callSid: effectiveCallSid,
      parentCallSid,
      limitSeconds,
      billingMode: reservation.billingMode,
    });
  }

  return new Response(null, { status: 204 });
}
