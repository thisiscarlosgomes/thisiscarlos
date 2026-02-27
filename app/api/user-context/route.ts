import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { getCredits } from "@/lib/agentchat/store";
import { CallLog } from "@/models/CallLog";
import { User } from "@/models/User";
import { isElevenLabsAuthorized, resolvePhoneFromRequest } from "@/lib/user-context-utils";

export const runtime = "nodejs";

type UserContextResponse = {
  firstName: string | null;
  previousCalls: number;
  lastCallSummary: string | null;
  creditsRemaining: number;
};

const EMPTY_CONTEXT: UserContextResponse = {
  firstName: null,
  previousCalls: 0,
  lastCallSummary: null,
  creditsRemaining: 0,
};

export async function GET(req: Request) {
  if (!isElevenLabsAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const hasPhoneParam = Boolean(url.searchParams.get("phone_number") || url.searchParams.get("call_sid"));
    if (!hasPhoneParam) {
      return NextResponse.json({ error: "Missing phone_number" }, { status: 400 });
    }

    const phoneNumber = await resolvePhoneFromRequest(url);

    if (!phoneNumber) {
      // Fail-soft to avoid breaking calls when upstream passes a malformed caller identifier.
      return NextResponse.json(EMPTY_CONTEXT, { status: 200 });
    }

    await connectToDatabase();

    // Keep this query lean to avoid hydration overhead on a hot webhook path.
    const user = await User.findOne({ phoneNumber })
      .select({ firstName: 1, callCredits: 1, walletUserId: 1, totalCalls: 1, lastCallSummary: 1 })
      .lean<{
        _id: Types.ObjectId;
        firstName: string | null;
        callCredits: number;
        walletUserId?: string | null;
        totalCalls?: number;
        lastCallSummary?: string | null;
      } | null>()
      .exec();

    if (!user) {
      return NextResponse.json(EMPTY_CONTEXT, { status: 200 });
    }

    let previousCalls = Math.max(0, Number(user.totalCalls ?? 0));
    let lastCallSummary = typeof user.lastCallSummary === "string" ? user.lastCallSummary : null;

    if (previousCalls <= 0 || !lastCallSummary) {
      const [fallbackCallCount, fallbackLastCall] = await Promise.all([
        previousCalls <= 0 ? CallLog.countDocuments({ userId: user._id }).exec() : Promise.resolve(previousCalls),
        !lastCallSummary
          ? CallLog.findOne({ userId: user._id })
              .sort({ createdAt: -1 })
              .select({ summary: 1 })
              .lean<{ summary: string } | null>()
              .exec()
          : Promise.resolve(null),
      ]);

      previousCalls = Math.max(0, Number(fallbackCallCount ?? previousCalls));
      lastCallSummary = lastCallSummary ?? fallbackLastCall?.summary ?? null;

      const materializedSet = {
        ...(previousCalls > 0 ? { totalCalls: previousCalls } : {}),
        ...(lastCallSummary ? { lastCallSummary } : {}),
      };
      if (Object.keys(materializedSet).length > 0) {
        void User.updateOne(
          { _id: user._id },
          {
            $set: materializedSet,
          }
        ).exec();
      }
    }

    const walletCredits = user.walletUserId ? await getCredits(user.walletUserId) : 0;

    const response: UserContextResponse = {
      firstName: user.firstName ?? null,
      previousCalls,
      lastCallSummary,
      creditsRemaining: Math.max(0, Number(walletCredits) || Number(user.callCredits) || 0),
    };

    return NextResponse.json(response, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
