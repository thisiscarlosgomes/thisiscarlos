import { NextResponse } from "next/server";
import {
  EFFECTIVE_FREE_CALL_DAILY_POOL_SECONDS,
  FREE_CALL_LIMIT_SECONDS,
  DISABLE_FREE_CALLS,
  TWILIO_FROM,
} from "@/lib/agentchat/config";
import { getFreeCallStatus } from "@/lib/agentchat/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const status = await getFreeCallStatus(
    EFFECTIVE_FREE_CALL_DAILY_POOL_SECONDS,
    FREE_CALL_LIMIT_SECONDS
  );

  return NextResponse.json(
    {
      freeCallsEnabled: !DISABLE_FREE_CALLS,
      dailyLimit: status.dailyLimit,
      callsMadeToday: status.confirmedCount,
      callsInFlight: status.inFlightCount,
      callsLeftToday: status.remainingCount,
      freePoolSecondsLeft: status.remainingPoolSeconds,
      freePoolSecondsTotal: EFFECTIVE_FREE_CALL_DAILY_POOL_SECONDS,
      maxFreeCallSeconds: status.maxPerCallSeconds,
      resetsAt: status.resetsAtIso,
      agentNumber: TWILIO_FROM || null,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
