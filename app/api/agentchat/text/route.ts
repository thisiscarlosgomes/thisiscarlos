import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, UIMessage } from "ai";
import { OPENAI_MODEL } from "@/lib/agentchat/config";
import { saveChatHistory, StoredChatMessage } from "@/lib/agentchat/chat-history-db";
import { buildKnowledgeContext } from "@/lib/agentchat/knowledge";

function extractMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function toStoredMessages(messages: UIMessage[]): StoredChatMessage[] {
  return messages
    .filter((m): m is UIMessage & { role: "user" | "assistant" } => {
      return m.role === "user" || m.role === "assistant";
    })
    .map((m) => ({ role: m.role, content: extractMessageText(m) }))
    .filter((m) => m.content.length > 0);
}

export async function POST(req: Request) {
  const body = (await req.json()) as { userId?: string; messages?: UIMessage[] };
  const userIdFromBody = body.userId?.trim() ?? "";
  const userIdFromQuery = new URL(req.url).searchParams.get("userId")?.trim() ?? "";
  const userId = userIdFromBody || userIdFromQuery;
  const messages = Array.isArray(body.messages) ? body.messages : [];

  if (messages.length === 0) {
    return NextResponse.json({ error: "At least one message is required." }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error: "Chat backend is not configured yet. Set OPENAI_API_KEY to enable free web text chat.",
      },
      { status: 500 }
    );
  }

  const baseSystemPrompt =
    "You are a practical AI agent for founders. Keep responses concise, actionable, and cost-aware.";

  let profileContext = "";
  try {
    profileContext = await readFile(path.join(process.cwd(), "sould.md"), "utf8");
  } catch {
    profileContext = "";
  }

  const systemPrompt = profileContext.trim().length
    ? `${baseSystemPrompt}\n\nUse this user profile context:\n\n${profileContext.trim()}`
    : baseSystemPrompt;

  const existingMessages = toStoredMessages(messages);
  const lastUserMessage = [...existingMessages].reverse().find((m) => m.role === "user")?.content ?? "";
  const knowledgeContext = await buildKnowledgeContext(lastUserMessage);
  const finalSystemPrompt = knowledgeContext.trim().length
    ? `${systemPrompt}\n\nUse this knowledge base when relevant:\n\n${knowledgeContext}`
    : systemPrompt;

  const result = streamText({
    model: openai(OPENAI_MODEL),
    system: finalSystemPrompt,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 300,
    onFinish: async ({ text }) => {
      if (!userId) return;

      const assistantText = text.trim();
      const nextMessages = assistantText
        ? [...existingMessages, { role: "assistant" as const, content: assistantText }]
        : existingMessages;

      saveChatHistory(userId, nextMessages);
    },
  });

  return result.toUIMessageStreamResponse();
}
