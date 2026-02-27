import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { recordToolMetric } from "@/lib/agentchat/tool-metrics";
import { User } from "@/models/User";
import { isElevenLabsAuthorized, resolvePhoneFromRequest } from "@/lib/user-context-utils";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const startedAt = Date.now();
  const finish = (statusCode: number, success: boolean, errorCode?: string | null) => {
    void recordToolMetric({
      tool: "get_user_name",
      statusCode,
      success,
      latencyMs: Date.now() - startedAt,
      errorCode: errorCode ?? null,
    });
  };

  if (!isElevenLabsAuthorized(req)) {
    finish(401, false, "unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const phoneNumber = await resolvePhoneFromRequest(url);
    if (!phoneNumber) {
      finish(200, true, "missing_phone");
      return NextResponse.json({ firstName: null }, { status: 200 });
    }

    await connectToDatabase();
    const user = await User.findOne({ phoneNumber })
      .select({ firstName: 1 })
      .lean<{ firstName?: string | null } | null>()
      .exec();

    finish(200, true);
    return NextResponse.json({ firstName: user?.firstName ?? null }, { status: 200 });
  } catch {
    finish(500, false, "internal_error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
