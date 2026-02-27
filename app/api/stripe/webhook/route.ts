import { NextResponse } from "next/server";
import { markStripeEventProcessed } from "@/lib/agentchat/store";
import { grantCreditsForCheckoutSession } from "@/lib/agentchat/credits-grant";
import { getStripe } from "@/lib/agentchat/stripe";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return NextResponse.json(
      { error: "Missing Stripe signature or webhook secret" },
      { status: 400 }
    );
  }

  const body = await req.text();

  try {
    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(body, signature, secret);

    if (!markStripeEventProcessed(event.id)) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const creditsRaw = session.metadata?.credits;
      const credits = Number(creditsRaw ?? 0);

      if (session.id && userId && Number.isFinite(credits) && credits > 0) {
        await grantCreditsForCheckoutSession({
          sessionId: session.id,
          userId,
          credits,
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid webhook" },
      { status: 400 }
    );
  }
}
