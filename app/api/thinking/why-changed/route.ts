import { NextResponse } from "next/server";
import { isElevenLabsAuthorized } from "@/lib/user-context-utils";
import { isOwnerRequest } from "@/lib/voice-notes/auth";
import { getWhyChanged } from "@/lib/agentchat/evolution";

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
  const days = Number(url.searchParams.get("days") ?? 60);
  const result = await getWhyChanged({ topic, days });
  return NextResponse.json(result);
}
