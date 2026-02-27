import { NextResponse } from "next/server";
import { grantCreditsForCheckoutSession } from "@/lib/agentchat/credits-grant";
import { getStripe } from "@/lib/agentchat/stripe";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { userId?: string; sessionId?: string };
    const userId = body.userId?.trim() ?? "";
    const sessionId = body.sessionId?.trim() ?? "";

    if (!userId || !sessionId) {
      return NextResponse.json({ error: "Missing userId or sessionId" }, { status: 400 });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session || session.mode !== "payment") {
      return NextResponse.json({ error: "Invalid checkout session" }, { status: 400 });
    }

    const metadataUserId = session.metadata?.userId?.trim() ?? "";
    const credits = Number(session.metadata?.credits ?? 0);
    const paid = session.payment_status === "paid";

    if (!paid || !metadataUserId || metadataUserId !== userId || !Number.isFinite(credits) || credits <= 0) {
      return NextResponse.json({ granted: false });
    }

    const result = await grantCreditsForCheckoutSession({
      sessionId: session.id,
      userId: metadataUserId,
      credits,
    });

    return NextResponse.json({ granted: result.granted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not confirm checkout" },
      { status: 500 }
    );
  }
}
