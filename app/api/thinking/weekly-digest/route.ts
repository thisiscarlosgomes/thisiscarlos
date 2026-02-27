import { NextResponse } from "next/server";
import { isElevenLabsAuthorized } from "@/lib/user-context-utils";
import { getWeeklyThinkingDigest } from "@/lib/agentchat/thinking";
import { isOwnerRequest } from "@/lib/voice-notes/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ownerRequest = isOwnerRequest(req);
  const toolRequest = isElevenLabsAuthorized(req);
  if (!ownerRequest && !toolRequest) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const digest = await getWeeklyThinkingDigest();
  return NextResponse.json({ digest });
}
