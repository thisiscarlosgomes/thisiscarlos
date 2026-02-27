import { NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/voice-notes/auth";
import { getMemoryQualityReport } from "@/lib/agentchat/memory-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") ?? 7);
  const report = await getMemoryQualityReport({ days });
  return NextResponse.json({ report });
}
