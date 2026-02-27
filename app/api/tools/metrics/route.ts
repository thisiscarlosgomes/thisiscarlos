import { NextResponse } from "next/server";
import { getToolMetricsSummary } from "@/lib/agentchat/tool-metrics";
import { isOwnerRequest } from "@/lib/voice-notes/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours") ?? 24);
  const summary = await getToolMetricsSummary({
    hours,
    tools: ["get_user_name", "get_current_thinking", "get_voice_note_context"],
  });
  return NextResponse.json(summary);
}
