import type { PaymentRequired, SettleResponse as X402SettleResponse } from "@x402/core/types";
import type { PaymentPayloadV1, PaymentRequirementsV1 } from "@x402/core/types/v1";
import {
  HTTPFacilitatorClient,
  type FacilitatorClient,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { createFacilitatorConfig } from "@coinbase/x402";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getStripe } from "@/lib/agentchat/stripe";

const DEFAULT_UNITS_PER_USD = 1_000_000;
const DEFAULT_TIMEOUT_SECONDS = 120;
const DEFAULT_SCHEME = "exact";
const DEFAULT_NETWORK = "base";
const DEFAULT_PUBLIC_FACILITATOR_URL = "https://x402.org/facilitator";
const DEFAULT_STRIPE_DEPOSIT_NETWORK_KEY = "base";
const DEFAULT_PAY_TO_PROOF_TTL_SECONDS = 900;
const DEFAULT_STRIPE_PAY_TO_CACHE_TTL_SECONDS = 1800;
const DEFAULT_MAINNET_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const DEFAULT_BASE_SEPOLIA_USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

let facilitatorClient: FacilitatorClient | null = null;

type X402PaymentMode = "cdp" | "stripe";

type StripePayToCacheEntry = {
  paymentIntentId: string;
  expiresAtMs: number;
};

type PayToProofPayload = {
  v: 1;
  p: string;
  a: string;
  n: string;
  s: string;
  exp: number;
};

const stripePayToAddressCache = new Map<string, StripePayToCacheEntry>();

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function parsePositiveAmount(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function normalizeAmountUsd(amountUsd: number): number {
  if (!Number.isFinite(amountUsd)) return 0;
  return Math.max(0, Math.floor(amountUsd));
}

function normalizeAddress(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function resolveX402PaymentMode(): X402PaymentMode {
  const mode =
    process.env.X402_PAYMENT_MODE?.trim().toLowerCase() ||
    process.env.X402_MODE?.trim().toLowerCase();
  if (mode === "stripe" || mode === "stripe_payment_intent" || mode === "payment_intent") {
    return "stripe";
  }
  if (mode === "cdp" || mode === "coinbase" || mode === "static") {
    return "cdp";
  }

  const configured = process.env.X402_PAY_TO_SOURCE?.trim().toLowerCase();
  if (
    configured === "stripe" ||
    configured === "stripe_payment_intent" ||
    configured === "payment_intent"
  ) {
    return "stripe";
  }
  if (configured === "static" || configured === "cdp" || configured === "coinbase") {
    return "cdp";
  }

  // If no static destination is configured, default to Stripe dynamic payTo mode.
  return process.env.X402_PAY_TO?.trim() ? "cdp" : "stripe";
}

function hasCdpCredentials(): boolean {
  const cdpApiKeyId = process.env.CDP_API_KEY_ID?.trim();
  const cdpApiKeySecret = process.env.CDP_API_KEY_SECRET?.trim();
  return Boolean(cdpApiKeyId && cdpApiKeySecret);
}

function resolveFacilitatorUrl(): string | undefined {
  const configuredUrl = process.env.X402_FACILITATOR_URL?.trim();
  if (configuredUrl) return configuredUrl;
  if (hasCdpCredentials()) return undefined;
  return DEFAULT_PUBLIC_FACILITATOR_URL;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

function resolvePayToProofSecret(): string {
  return (
    process.env.X402_PAY_TO_SIGNING_SECRET?.trim() || process.env.STRIPE_SECRET_KEY?.trim() || ""
  );
}

function signPayToProofPayload(payloadB64: string): string {
  const secret = resolvePayToProofSecret();
  return createHmac("sha256", secret).update(payloadB64).digest("hex");
}

function createPayToProof(input: {
  payTo: string;
  amountAtomic: string;
  network: string;
  asset: string;
}): string | null {
  const secret = resolvePayToProofSecret();
  if (!secret) return null;

  const ttlSeconds = parsePositiveInt(
    process.env.X402_PAY_TO_PROOF_TTL_SECONDS,
    DEFAULT_PAY_TO_PROOF_TTL_SECONDS
  );
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: PayToProofPayload = {
    v: 1,
    p: normalizeAddress(input.payTo),
    a: String(input.amountAtomic),
    n: String(input.network).toLowerCase(),
    s: normalizeAddress(input.asset),
    exp: nowSeconds + ttlSeconds,
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayToProofPayload(payloadB64);
  return `${payloadB64}.${signature}`;
}

function verifyPayToProof(
  token: string,
  expected: { payTo: string; amountAtomic: string; network: string; asset: string }
): boolean {
  const secret = resolvePayToProofSecret();
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return false;

  const expectedSignature = signPayToProofPayload(payloadB64);
  if (!constantTimeEquals(signature, expectedSignature)) {
    return false;
  }

  let payload: PayToProofPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64)) as PayToProofPayload;
  } catch {
    return false;
  }

  if (!payload || payload.v !== 1) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) return false;

  return (
    normalizeAddress(payload.p) === normalizeAddress(expected.payTo) &&
    String(payload.a) === String(expected.amountAtomic) &&
    String(payload.n).toLowerCase() === String(expected.network).toLowerCase() &&
    normalizeAddress(payload.s) === normalizeAddress(expected.asset)
  );
}

function pruneStripePayToCache(): void {
  const now = Date.now();
  for (const [payTo, entry] of stripePayToAddressCache.entries()) {
    if (entry.expiresAtMs <= now) {
      stripePayToAddressCache.delete(payTo);
    }
  }
}

function rememberStripePayToAddress(payTo: string, paymentIntentId: string): void {
  const ttlSeconds = parsePositiveInt(
    process.env.X402_STRIPE_PAY_TO_CACHE_TTL_SECONDS,
    DEFAULT_STRIPE_PAY_TO_CACHE_TTL_SECONDS
  );
  pruneStripePayToCache();
  stripePayToAddressCache.set(normalizeAddress(payTo), {
    paymentIntentId,
    expiresAtMs: Date.now() + ttlSeconds * 1000,
  });
}

function hasIssuedStripePayToAddress(payTo: string): boolean {
  pruneStripePayToCache();
  return stripePayToAddressCache.has(normalizeAddress(payTo));
}

function getPaymentAcceptedPayTo(payment: PaymentPayload | PaymentPayloadV1): string {
  if (!payment || typeof payment !== "object") return "";

  const candidate = payment as PaymentPayload & {
    payload?: {
      authorization?: {
        to?: unknown;
      };
    };
  };

  if (candidate.accepted && typeof candidate.accepted === "object") {
    const acceptedPayTo =
      "payTo" in candidate.accepted ? (candidate.accepted as { payTo?: unknown }).payTo : "";
    if (typeof acceptedPayTo === "string" && acceptedPayTo.trim()) {
      return normalizeAddress(acceptedPayTo);
    }
  }

  const authorizationTo = candidate.payload?.authorization?.to;
  if (typeof authorizationTo === "string" && authorizationTo.trim()) {
    return normalizeAddress(authorizationTo);
  }

  return "";
}

function getPaymentAcceptedPayToProof(payment: PaymentPayload | PaymentPayloadV1): string {
  if (!payment || typeof payment !== "object") return "";
  const candidate = payment as PaymentPayload;
  const extra =
    candidate.accepted && typeof candidate.accepted === "object"
      ? (candidate.accepted as { extra?: unknown }).extra
      : null;
  if (!extra || typeof extra !== "object") return "";
  const maybeProof = (extra as Record<string, unknown>).payToProof;
  return typeof maybeProof === "string" ? maybeProof.trim() : "";
}

function resolveStripeDepositNetworkKey(): string {
  return (
    process.env.X402_STRIPE_DEPOSIT_NETWORK_KEY?.trim().toLowerCase() ||
    DEFAULT_STRIPE_DEPOSIT_NETWORK_KEY
  );
}

async function createStripePayToAddress(input: {
  amountUsd: number;
  credits: number;
  resourceUrl: string;
  userId: string;
}): Promise<{ payTo: string; paymentIntentId: string }> {
  const stripe = getStripe();
  const amountInCents = Math.max(1, Math.floor(input.amountUsd * 100));
  let paymentIntent: Awaited<ReturnType<typeof stripe.paymentIntents.create>>;
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      payment_method_types: ["crypto"],
      payment_method_data: {
        type: "crypto",
      },
      payment_method_options: {
        // Stripe crypto payment mode from x402 docs/sample.
        crypto: {
          mode: "custom",
        },
      } as unknown as Record<string, unknown>,
      confirm: true,
      metadata: {
        purpose: "x402_credits",
        userId: input.userId,
        amountUsd: String(input.amountUsd),
        credits: String(input.credits),
        resource: input.resourceUrl,
      },
    } as unknown as Parameters<typeof stripe.paymentIntents.create>[0]);
  } catch (error) {
    const candidate = error as {
      type?: unknown;
      param?: unknown;
      message?: unknown;
    };
    const isStripeInvalidRequest =
      candidate && String(candidate.type ?? "") === "StripeInvalidRequestError";
    const unknownCustomModeParam =
      String(candidate.param ?? "") === "payment_method_options[crypto][mode]";
    if (isStripeInvalidRequest && unknownCustomModeParam) {
      throw new Error(
        "Stripe x402 custom crypto payins are not enabled on this account. Ask Stripe to enable machine payments/x402 for this account."
      );
    }
    throw error;
  }

  const nextAction = paymentIntent.next_action as
    | {
        crypto_collect_deposit_details?: {
          deposit_addresses?: Record<string, { address?: string }>;
        };
      }
    | null;
  const depositAddresses = nextAction?.crypto_collect_deposit_details?.deposit_addresses;
  if (!depositAddresses || typeof depositAddresses !== "object") {
    throw new Error("PaymentIntent did not return expected crypto deposit details");
  }

  const preferredKey = resolveStripeDepositNetworkKey();
  const preferred = depositAddresses[preferredKey];
  const firstAddressRecord =
    preferred && typeof preferred === "object"
      ? preferred
      : Object.values(depositAddresses).find((value) => value && typeof value === "object");
  const payTo = normalizeAddress(firstAddressRecord?.address);

  if (!payTo) {
    throw new Error("PaymentIntent did not return a usable deposit address");
  }

  rememberStripePayToAddress(payTo, paymentIntent.id);
  return { payTo, paymentIntentId: paymentIntent.id };
}

function resolveEip712Domain(input: { network: string; asset: string }): { name: string; version: string } {
  const configuredName = process.env.X402_ASSET_NAME?.trim();
  const configuredVersion = process.env.X402_ASSET_VERSION?.trim();
  if (configuredName && configuredVersion) {
    return { name: configuredName, version: configuredVersion };
  }

  const network = input.network.toLowerCase();
  const asset = normalizeAddress(input.asset);

  const isBaseMainnetNetwork = network === "base" || network === "eip155:8453";
  const isBaseSepoliaNetwork = network === "base-sepolia" || network === "eip155:84532";

  if (isBaseMainnetNetwork && asset === DEFAULT_MAINNET_USDC) {
    return { name: "USD Coin", version: "2" };
  }

  if (isBaseSepoliaNetwork && asset === DEFAULT_BASE_SEPOLIA_USDC) {
    return { name: "USDC", version: "2" };
  }

  // Safe fallback for USDC-family contracts when no mapping is available.
  return { name: "USD Coin", version: "2" };
}

function normalizeLegacyNetwork(network: string): PaymentRequirementsV1["network"] {
  const normalized = network.trim().toLowerCase();
  if (normalized === "base") return "eip155:8453";
  if (normalized === "base-sepolia") return "eip155:84532";
  return normalized as PaymentRequirementsV1["network"];
}

function normalizeV2Network(network: string): PaymentRequirements["network"] {
  const normalized = network.trim().toLowerCase();
  if (normalized.includes(":")) {
    return normalized as PaymentRequirements["network"];
  }
  if (normalized === "base") return "eip155:8453";
  if (normalized === "base-sepolia") return "eip155:84532";
  return normalized as PaymentRequirements["network"];
}

function toAtomicUsdAmount(amountUsd: number): string {
  const normalizedUsd = normalizeAmountUsd(amountUsd);
  const atomicUnitsPerUsd = parsePositiveAmount(
    process.env.X402_UNITS_PER_USD,
    DEFAULT_UNITS_PER_USD
  );
  return String(normalizedUsd * atomicUnitsPerUsd);
}

export function isX402Configured(): boolean {
  const asset = process.env.X402_ASSET?.trim();
  const network = process.env.X402_NETWORK?.trim();
  if (!asset || !network) return false;

  const paymentMode = resolveX402PaymentMode();
  if (paymentMode === "stripe") {
    return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  }

  return Boolean(process.env.X402_PAY_TO?.trim());
}

export function getX402Facilitator(): FacilitatorClient {
  if (facilitatorClient) {
    return facilitatorClient;
  }

  const configuredUrl = resolveFacilitatorUrl();

  if (hasCdpCredentials()) {
    const cdpApiKeyId = process.env.CDP_API_KEY_ID?.trim();
    const cdpApiKeySecret = process.env.CDP_API_KEY_SECRET?.trim();
    const facilitatorConfig = createFacilitatorConfig(cdpApiKeyId, cdpApiKeySecret);
    facilitatorClient = new HTTPFacilitatorClient({
      ...facilitatorConfig,
      ...(configuredUrl ? { url: configuredUrl } : {}),
    });
    return facilitatorClient;
  }

  facilitatorClient = new HTTPFacilitatorClient(
    configuredUrl ? { url: configuredUrl } : undefined
  );

  return facilitatorClient;
}

function isX402PaymentPayload(value: unknown): value is PaymentPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.x402Version === "number" &&
    typeof candidate.payload === "object" &&
    candidate.payload !== null
  );
}

export type CreditsX402Quote = {
  requirements: PaymentRequirements;
  legacyRequirements: PaymentRequirementsV1;
  paymentRequired: PaymentRequired;
  amountAtomic: string;
};

export function buildCreditsX402Quote(input: {
  amountUsd: number;
  credits: number;
  resourceUrl: string;
  payTo: string;
  payToProof?: string;
  payToSource?: X402PaymentMode;
}): CreditsX402Quote {
  const scheme = process.env.X402_SCHEME?.trim() || DEFAULT_SCHEME;
  const configuredNetwork = process.env.X402_NETWORK?.trim() || DEFAULT_NETWORK;
  const network = normalizeV2Network(configuredNetwork);
  const legacyNetwork = normalizeLegacyNetwork(configuredNetwork);
  const asset = process.env.X402_ASSET?.trim() || "";
  const payTo = input.payTo.trim();
  const maxTimeoutSeconds = parsePositiveInt(
    process.env.X402_MAX_TIMEOUT_SECONDS,
    DEFAULT_TIMEOUT_SECONDS
  );
  const amountAtomic = toAtomicUsdAmount(input.amountUsd);
  const domain = resolveEip712Domain({
    network: String(network),
    asset,
  });

  const requirements: PaymentRequirements = {
    scheme,
    network,
    amount: amountAtomic,
    asset,
    payTo,
    maxTimeoutSeconds,
    extra: {
      name: domain.name,
      version: domain.version,
      credits: String(input.credits),
      amountUsd: String(normalizeAmountUsd(input.amountUsd)),
      resource: input.resourceUrl,
      description: `${input.credits} credits`,
      purpose: "call_credits",
      payToSource: input.payToSource ?? resolveX402PaymentMode(),
      ...(input.payToProof ? { payToProof: input.payToProof } : {}),
    },
  };

  const legacyRequirements: PaymentRequirementsV1 = {
    scheme,
    network: legacyNetwork,
    maxAmountRequired: amountAtomic,
    resource: input.resourceUrl,
    description: `${input.credits} credits`,
    mimeType: "application/json",
    outputSchema: {},
    payTo,
    maxTimeoutSeconds,
    asset,
    extra: {
      name: domain.name,
      version: domain.version,
      credits: String(input.credits),
      amountUsd: String(normalizeAmountUsd(input.amountUsd)),
      purpose: "call_credits",
      payToSource: input.payToSource ?? resolveX402PaymentMode(),
      ...(input.payToProof ? { payToProof: input.payToProof } : {}),
    },
  };

  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: input.resourceUrl,
      description: "Buy call credits",
      mimeType: "application/json",
    },
    accepts: [requirements as PaymentRequired["accepts"][number]],
  };

  return { requirements, legacyRequirements, paymentRequired, amountAtomic };
}

export function isX402PaymentPayloadV1(value: unknown): value is PaymentPayloadV1 {
  return Boolean(value && typeof value === "object" && "x402Version" in value && (value as { x402Version?: unknown }).x402Version === 1);
}

export type CreditsX402PayToResolution = {
  payTo: string;
  payToSource: X402PaymentMode;
  payToProof?: string;
  paymentIntentId?: string;
};

export async function resolveCreditsX402PayTo(input: {
  amountUsd: number;
  credits: number;
  resourceUrl: string;
  userId: string;
  payment: PaymentPayload | PaymentPayloadV1 | null;
}): Promise<CreditsX402PayToResolution> {
  const payToSource = resolveX402PaymentMode();

  if (payToSource === "cdp") {
    const payTo = process.env.X402_PAY_TO?.trim() || "";
    if (!payTo) {
      throw new Error("X402_PAY_TO is required for cdp x402 mode.");
    }
    return { payTo, payToSource };
  }

  const configuredNetwork = process.env.X402_NETWORK?.trim() || DEFAULT_NETWORK;
  const network = normalizeV2Network(configuredNetwork);
  const asset = process.env.X402_ASSET?.trim() || "";
  const amountAtomic = toAtomicUsdAmount(input.amountUsd);

  if (input.payment) {
    const payTo = getPaymentAcceptedPayTo(input.payment);
    if (!payTo) {
      throw new Error("Invalid x402 payment: missing payTo destination.");
    }

    const payToProof = getPaymentAcceptedPayToProof(input.payment);
    if (
      payToProof &&
      verifyPayToProof(payToProof, {
        payTo,
        amountAtomic,
        network: String(network),
        asset,
      })
    ) {
      return { payTo, payToSource, payToProof };
    }

    if (hasIssuedStripePayToAddress(payTo)) {
      return { payTo, payToSource };
    }

    throw new Error("Invalid x402 payment: payTo address was not issued by this server.");
  }

  const { payTo, paymentIntentId } = await createStripePayToAddress({
    amountUsd: input.amountUsd,
    credits: input.credits,
    resourceUrl: input.resourceUrl,
    userId: input.userId,
  });
  const payToProof = createPayToProof({
    payTo,
    amountAtomic,
    network: String(network),
    asset,
  });

  return {
    payTo,
    payToSource,
    ...(payToProof ? { payToProof } : {}),
    paymentIntentId,
  };
}

export function extractX402PaymentPayload(input: {
  req: Request;
  body: unknown;
}): PaymentPayload | null {
  const { req, body } = input;

  if (isX402PaymentPayload(body)) {
    return body;
  }

  if (body && typeof body === "object" && "payment" in body) {
    const nested = (body as { payment?: unknown }).payment;
    if (isX402PaymentPayload(nested)) {
      return nested;
    }
  }

  const encodedPayment =
    req.headers.get("payment-signature") ?? req.headers.get("x-payment");
  if (!encodedPayment) {
    return null;
  }

  try {
    const decoded = decodePaymentSignatureHeader(encodedPayment);
    return isX402PaymentPayload(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function applyPaymentRequiredHeader(
  response: Response,
  paymentRequired: PaymentRequired
): void {
  const encoded = encodePaymentRequiredHeader(paymentRequired);
  response.headers.set("PAYMENT-REQUIRED", encoded);
}

export function applyPaymentSettledHeaders(
  response: Response,
  settle: SettleResponse
): void {
  const settlement: X402SettleResponse = {
    success: settle.success,
    transaction: settle.transaction,
    payer: settle.payer,
    network: settle.network as X402SettleResponse["network"],
    ...(settle.errorReason ? { errorReason: settle.errorReason } : {}),
  };

  const encoded = encodePaymentResponseHeader(settlement);
  response.headers.set("PAYMENT-RESPONSE", encoded);
  response.headers.set("X-PAYMENT-RESPONSE", encoded);
}
