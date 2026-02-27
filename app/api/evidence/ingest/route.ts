import { NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/voice-notes/auth";
import { ingestEvidence } from "@/lib/agentchat/evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  url?: string;
  beliefId?: string;
};

export async function POST(req: Request) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const url = String(body.url ?? "").trim();
  const beliefId = String(body.beliefId ?? "").trim() || null;
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  try {
    const evidence = await ingestEvidence({ url, beliefId });
    return NextResponse.json({ evidence }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not ingest evidence";
    const status = /invalid|missing|not found/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
