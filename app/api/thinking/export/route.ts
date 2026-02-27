import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { exportThinkingMarkdown } from "@/lib/agentchat/thinking-export";
import { isOwnerRequest } from "@/lib/voice-notes/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isBearerAuthorized(req: Request): boolean {
  const expected = String(process.env.THINKING_EXPORT_SECRET ?? "").trim();
  if (!expected) return false;
  const auth = String(req.headers.get("authorization") ?? "").trim();
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice("Bearer ".length).trim();
  return Boolean(token) && token === expected;
}

export async function POST(req: Request) {
  if (!isOwnerRequest(req) && !isBearerAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await exportThinkingMarkdown();
    return NextResponse.json({
      ok: true,
      dir: result.dir,
      files: [result.currentPath, result.timelinePath],
    });
  } catch (error) {
    console.error("manual thinking export failed", error);
    return NextResponse.json({ error: "Could not export thinking markdown" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!isOwnerRequest(req) && !isBearerAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const fileParam = String(url.searchParams.get("file") ?? "current").trim().toLowerCase();
  if (fileParam !== "current" && fileParam !== "timeline") {
    return NextResponse.json({ error: "Invalid file. Use current or timeline" }, { status: 400 });
  }

  try {
    const result = await exportThinkingMarkdown();
    const targetPath = fileParam === "current" ? result.currentPath : result.timelinePath;
    const content = await readFile(targetPath, "utf8");
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${fileParam}.md\"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("thinking markdown download failed", error);
    return NextResponse.json({ error: "Could not download thinking markdown" }, { status: 500 });
  }
}
