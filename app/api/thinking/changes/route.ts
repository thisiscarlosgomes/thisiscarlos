import { NextResponse } from "next/server";
import { isElevenLabsAuthorized } from "@/lib/user-context-utils";
import { getThinkingChanges } from "@/lib/agentchat/thinking";
import { isOwnerRequest } from "@/lib/voice-notes/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ownerRequest = isOwnerRequest(req);
  const toolRequest = isElevenLabsAuthorized(req);
  if (!ownerRequest && !toolRequest) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const topic = String(url.searchParams.get("topic") ?? "").trim();
  const days = Number(url.searchParams.get("days") ?? 7);
  const limit = Number(url.searchParams.get("limit") ?? 5);
  const changes = await getThinkingChanges({ topic, days, limit });
  return NextResponse.json({ changes });
}
