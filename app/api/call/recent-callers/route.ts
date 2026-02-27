import { NextResponse } from "next/server";
import { getRecentAnonymousCallers } from "@/lib/agentchat/call-log";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get("limit") ?? 5);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(200, Math.floor(limitParam)))
    : 5;

  const callers = await getRecentAnonymousCallers(limit).catch(() => []);

  return NextResponse.json(
    { callers },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
