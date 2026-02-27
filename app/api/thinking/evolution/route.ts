import { NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/voice-notes/auth";
import { getBeliefEvolution } from "@/lib/agentchat/evolution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const topic = String(url.searchParams.get("topic") ?? "").trim();
  const days = Number(url.searchParams.get("days") ?? 30);
  const limit = Number(url.searchParams.get("limit") ?? 100);

  const evolution = await getBeliefEvolution({ topic, days, limit });
  return NextResponse.json({ evolution });
}
