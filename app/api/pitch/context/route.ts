import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { isElevenLabsAuthorized } from "@/lib/user-context-utils";
import { PitchSubmission } from "@/models/PitchSubmission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isElevenLabsAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const email = String(url.searchParams.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  await connectToDatabase();
  const pitch = await PitchSubmission.findOne({ email })
    .sort({ createdAt: -1 })
    .select({ projectName: 1, raiseAmountUsd: 1, valuationUsd: 1, details: 1, createdAt: 1 })
    .lean<{
      projectName: string;
      raiseAmountUsd: number;
      valuationUsd: number;
      details: string;
      createdAt: Date;
    } | null>()
    .exec();

  if (!pitch) {
    return NextResponse.json(
      {
        hasPitch: false,
        projectName: null,
        raiseAmountUsd: null,
        valuationUsd: null,
        brief: null,
        submittedAt: null,
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      hasPitch: true,
      projectName: pitch.projectName,
      raiseAmountUsd: pitch.raiseAmountUsd,
      valuationUsd: pitch.valuationUsd,
      brief: pitch.details.slice(0, 220),
      submittedAt: pitch.createdAt.toISOString(),
    },
    { status: 200 }
  );
}
