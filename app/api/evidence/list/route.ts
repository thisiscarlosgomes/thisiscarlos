import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { isOwnerRequest } from "@/lib/voice-notes/auth";
import { Evidence } from "@/models/Evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const beliefIdRaw = String(url.searchParams.get("beliefId") ?? "").trim();
  const requestedLimit = Number(url.searchParams.get("limit") ?? 200);
  const limit = Math.min(500, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 200));

  const filter: Record<string, unknown> = {};
  if (beliefIdRaw) {
    if (!Types.ObjectId.isValid(beliefIdRaw)) {
      return NextResponse.json({ error: "Invalid beliefId" }, { status: 400 });
    }
    filter.beliefId = new Types.ObjectId(beliefIdRaw);
  }

  await connectToDatabase();
  const evidence = await Evidence.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .select({
      beliefId: 1,
      url: 1,
      domain: 1,
      title: 1,
      summary: 1,
      excerpt: 1,
      stance: 1,
      qualityScore: 1,
      fetchedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .lean<
      Array<{
        _id: Types.ObjectId;
        beliefId: Types.ObjectId | null;
        url: string;
        domain: string;
        title: string | null;
        summary: string;
        excerpt: string;
        stance: "supports" | "challenges" | "neutral";
        qualityScore: number;
        fetchedAt: Date;
        createdAt: Date;
        updatedAt: Date;
      }>
    >()
    .exec();

  return NextResponse.json({
    evidence: evidence.map((row) => ({
      id: String(row._id),
      beliefId: row.beliefId ? String(row.beliefId) : null,
      url: row.url,
      domain: row.domain,
      title: row.title,
      summary: row.summary,
      excerpt: row.excerpt,
      stance: row.stance,
      qualityScore: row.qualityScore,
      fetchedAt: new Date(row.fetchedAt).toISOString(),
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    })),
  });
}
