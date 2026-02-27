import { NextResponse } from "next/server";
import { getPaidCallHistoryForWalletUser } from "@/lib/agentchat/call-log";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = String(searchParams.get("userId") ?? "").trim();
  if (!userId) {
    return NextResponse.json({ history: [] });
  }

  const history = await getPaidCallHistoryForWalletUser(userId, 5).catch(() => []);
  return NextResponse.json(
    { history },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
