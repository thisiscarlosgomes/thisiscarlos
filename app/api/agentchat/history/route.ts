import { NextResponse } from "next/server";
import { UIMessage } from "ai";
import { getChatHistory } from "@/lib/agentchat/chat-history-db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId")?.trim();

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const history = getChatHistory(userId);

  const messages: UIMessage[] = history.map((message, index) => ({
    id: `history-${index}`,
    role: message.role,
    parts: [{ type: "text", text: message.content }],
  }));

  return NextResponse.json({ messages });
}
