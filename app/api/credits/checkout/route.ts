import { NextResponse } from "next/server";
import {
  CREDITS_PER_DOLLAR,
  MAX_CREDIT_PURCHASE_USD,
  MIN_CREDIT_PURCHASE_USD,
  SITE_URL,
} from "@/lib/agentchat/config";
import { ensureUser, getCredits } from "@/lib/agentchat/store";
import { grantCreditsForCheckoutSession } from "@/lib/agentchat/credits-grant";
import { getStripe } from "@/lib/agentchat/stripe";
import {
  applyPaymentRequiredHeader,
  applyPaymentSettledHeaders,
  buildCreditsX402Quote,
  extractX402PaymentPayload,
  getX402Facilitator,
  isX402PaymentPayloadV1,
  isX402Configured,
  resolveCreditsX402PayTo,
} from "@/lib/agentchat/x402";

export const runtime = "nodejs";

type CheckoutProvider = "x402" | "stripe";

type CheckoutBody = {
  userId?: string;
  amountUsd?: number;
  provider?: CheckoutProvider;
  payment?: unknown;
};

function resolveBaseUrl(req: Request): string {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const requestOrigin = new URL(req.url).origin;
  return requestOrigin || SITE_URL;
}

function normalizeProvider(value: unknown): CheckoutProvider | null {
  if (value === "x402" || value === "stripe") return value;
  return null;
}

function normalizeAmountUsd(value: unknown): number {
  const parsed = Math.floor(Number(value ?? 0));
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

async function createStripeCheckoutResponse(input: {
  req: Request;
  userId: string;
  amountUsd: number;
}): Promise<Response> {
  const baseUrl = resolveBaseUrl(input.req);
  const credits = input.amountUsd * CREDITS_PER_DOLLAR;
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: input.amountUsd,
        price_data: {
          currency: "usd",
          unit_amount: 100,
          product_data: {
            name: "$1 credit top-up",
            description: `${CREDITS_PER_DOLLAR} credits per $1 for AI voice calls`,
          },
        },
      },
    ],
    metadata: {
      userId: input.userId,
      credits: String(credits),
      amountUsd: String(input.amountUsd),
    },
    success_url: `${baseUrl}/c?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/c?checkout=cancel`,
  });

  return NextResponse.json({ checkoutUrl: session.url, provider: "stripe" });
}

async function createX402CheckoutResponse(input: {
  req: Request;
  userId: string;
  amountUsd: number;
  credits: number;
  body: CheckoutBody;
}): Promise<Response> {
  const resourceUrl = new URL(input.req.url).toString();
  const payment = extractX402PaymentPayload({ req: input.req, body: input.body });
  const createQuoteForPayment = async (paymentPayload: typeof payment) => {
    const payToResolution = await resolveCreditsX402PayTo({
      amountUsd: input.amountUsd,
      credits: input.credits,
      resourceUrl,
      userId: input.userId,
      payment: paymentPayload,
    });
    const quote = buildCreditsX402Quote({
      amountUsd: input.amountUsd,
      credits: input.credits,
      resourceUrl,
      payTo: payToResolution.payTo,
      payToProof: payToResolution.payToProof,
      payToSource: payToResolution.payToSource,
    });
    return { quote, payToResolution };
  };

  let quoteBundle: Awaited<ReturnType<typeof createQuoteForPayment>>;
  try {
    quoteBundle = await createQuoteForPayment(payment);
  } catch (error) {
    if (!payment) {
      throw error;
    }

    // If the submitted payment used an invalid/expired payTo, return a fresh 402 quote.
    const fallback = await createQuoteForPayment(null);
    const response = NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid x402 payment destination. Please retry payment.",
        provider: "x402",
        x402Version: 2,
        accepts: [fallback.quote.requirements],
        resource: fallback.quote.paymentRequired.resource,
        quote: {
          amountUsd: input.amountUsd,
          amountAtomic: fallback.quote.amountAtomic,
          credits: input.credits,
        },
      },
      { status: 402 }
    );
    applyPaymentRequiredHeader(response, fallback.quote.paymentRequired);
    return response;
  }

  const { quote } = quoteBundle;

  if (!payment) {
    const response = NextResponse.json(
      {
        error: "Payment required",
        provider: "x402",
        // Keep body + PAYMENT-REQUIRED header aligned to v2 for @x402/fetch clients.
        x402Version: 2,
        accepts: [quote.requirements],
        resource: quote.paymentRequired.resource,
        quote: {
          amountUsd: input.amountUsd,
          amountAtomic: quote.amountAtomic,
          credits: input.credits,
        },
      },
      { status: 402 }
    );
    applyPaymentRequiredHeader(response, quote.paymentRequired);
    return response;
  }

  const facilitator = getX402Facilitator();
  const selectedRequirements = isX402PaymentPayloadV1(payment)
    ? (quote.legacyRequirements as unknown as typeof quote.requirements)
    : quote.requirements;
  const verification = await facilitator.verify(
    payment as unknown as Parameters<typeof facilitator.verify>[0],
    selectedRequirements as Parameters<typeof facilitator.verify>[1]
  );

  if (!verification.isValid) {
    const response = NextResponse.json(
      {
        error: verification.invalidReason || "Invalid x402 payment",
        provider: "x402",
      },
      { status: 402 }
    );
    applyPaymentRequiredHeader(response, quote.paymentRequired);
    return response;
  }

  const settlement = await facilitator.settle(
    payment as unknown as Parameters<typeof facilitator.settle>[0],
    selectedRequirements as Parameters<typeof facilitator.settle>[1]
  );
  if (!settlement.success || !settlement.transaction) {
    return NextResponse.json(
      {
        error: settlement.errorReason || "x402 settlement failed",
        provider: "x402",
        ...(settlement.errorMessage ? { details: settlement.errorMessage } : {}),
        ...(settlement.transaction ? { transaction: settlement.transaction } : {}),
      },
      { status: 402 }
    );
  }

  const sessionId = `x402:${settlement.network}:${settlement.transaction}`;
  const grant = await grantCreditsForCheckoutSession({
    sessionId,
    userId: input.userId,
    credits: input.credits,
  });
  const balance = await getCredits(input.userId);

  const response = NextResponse.json({
    provider: "x402",
    granted: grant.granted,
    creditsAdded: grant.granted ? input.credits : 0,
    balance,
    transaction: settlement.transaction,
    payer: settlement.payer,
    network: settlement.network,
  });
  applyPaymentSettledHeaders(response, settlement);
  return response;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as CheckoutBody;

    if (!body.userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const amountUsd = normalizeAmountUsd(body.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd < MIN_CREDIT_PURCHASE_USD) {
      return NextResponse.json(
        { error: `Minimum purchase is $${MIN_CREDIT_PURCHASE_USD}.` },
        { status: 400 }
      );
    }

    const clampedAmountUsd = Math.min(MAX_CREDIT_PURCHASE_USD, amountUsd);
    const user = await ensureUser(body.userId);
    const credits = clampedAmountUsd * CREDITS_PER_DOLLAR;
    const requestedProvider = normalizeProvider(body.provider);
    const provider: CheckoutProvider =
      requestedProvider ?? (isX402Configured() ? "x402" : "stripe");

    if (provider === "x402" && !isX402Configured()) {
      return NextResponse.json(
        {
          error:
            "x402 is not configured. CDP mode: set X402_PAYMENT_MODE=cdp with X402_NETWORK, X402_ASSET, X402_PAY_TO. Stripe mode: set X402_PAYMENT_MODE=stripe and STRIPE_SECRET_KEY.",
        },
        { status: 503 }
      );
    }

    if (provider === "x402") {
      return await createX402CheckoutResponse({
        req,
        userId: user.userId,
        amountUsd: clampedAmountUsd,
        credits,
        body,
      });
    }

    return await createStripeCheckoutResponse({
      req,
      userId: user.userId,
      amountUsd: clampedAmountUsd,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not create checkout session",
      },
      { status: 500 }
    );
  }
}
