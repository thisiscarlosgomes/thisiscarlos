import { NextResponse } from "next/server";
import { ensureUser, getCredits } from "@/lib/agentchat/store";

function parseUserId(req: Request): string {
  const url = new URL(req.url);
  const queryUserId = url.searchParams.get("userId")?.trim();
  const headerUserId = req.headers.get("x-user-id")?.trim();
  const userId = queryUserId || headerUserId;

  if (!userId) {
    throw new Error("Missing userId");
  }
  return userId;
}

export async function GET(req: Request) {
  try {
    const userId = parseUserId(req);
    const user = await ensureUser(userId);
    const credits = await getCredits(user.userId);

    return NextResponse.json({
      userId: user.userId,
      pin: user.pin,
      credits,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }
}
