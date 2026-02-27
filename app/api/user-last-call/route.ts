import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { CallLog } from "@/models/CallLog";
import { User } from "@/models/User";
import { isElevenLabsAuthorized, resolvePhoneFromRequest } from "@/lib/user-context-utils";

export const runtime = "nodejs";

type LastCallResponse = {
  previousCalls: number;
  lastCallSummary: string | null;
};

const EMPTY: LastCallResponse = {
  previousCalls: 0,
  lastCallSummary: null,
};

export async function GET(req: Request) {
  if (!isElevenLabsAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const phoneNumber = await resolvePhoneFromRequest(url);
    if (!phoneNumber) {
      return NextResponse.json(EMPTY, { status: 200 });
    }

    await connectToDatabase();
    const user = await User.findOne({ phoneNumber })
      .select({ _id: 1, totalCalls: 1, lastCallSummary: 1 })
      .lean<{ _id: Types.ObjectId; totalCalls?: number; lastCallSummary?: string | null } | null>()
      .exec();
    if (!user) {
      return NextResponse.json(EMPTY, { status: 200 });
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

    return NextResponse.json(
      {
        previousCalls,
        lastCallSummary,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
