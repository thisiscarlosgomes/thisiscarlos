export const MAX_CALL_MINUTES = Number(process.env.MAX_CALL_MINUTES ?? 5);
export const DISABLE_FREE_CALLS =
  process.env.DISABLE_FREE_CALLS === "1" || process.env.DISABLE_FREE_CALLS === "true";
export const MAX_PAID_CALL_MINUTES = Math.max(
  0,
  Math.floor(Number(process.env.MAX_PAID_CALL_MINUTES ?? 0))
);
export const FREE_CALL_MINUTES = Math.max(1, Math.floor(Number(process.env.FREE_CALL_MINUTES ?? 1)));
export const FREE_CALL_LIMIT_SECONDS = Math.max(
  1,
  Math.floor(Number(process.env.FREE_CALL_LIMIT_SECONDS ?? 120))
);
export const FREE_CALL_DAILY_LIMIT = Math.max(
  0,
  Math.floor(Number(process.env.FREE_CALL_DAILY_LIMIT ?? 5))
);
export const FREE_CALL_DAILY_POOL_SECONDS = Math.max(
  0,
  Math.floor(
    Number(
      process.env.FREE_CALL_DAILY_POOL_SECONDS ??
        Math.max(1, FREE_CALL_DAILY_LIMIT) * Math.max(1, FREE_CALL_LIMIT_SECONDS)
    )
  )
);
export const EFFECTIVE_FREE_CALL_DAILY_POOL_SECONDS = DISABLE_FREE_CALLS
  ? 0
  : FREE_CALL_DAILY_POOL_SECONDS;
export const FREE_CALL_COUNT_MIN_SECONDS = Math.max(
  0,
  Math.floor(Number(process.env.FREE_CALL_COUNT_MIN_SECONDS ?? 10))
);
export const CREDITS_PER_DOLLAR = Math.max(
  1,
  Math.floor(Number(process.env.CREDITS_PER_DOLLAR ?? 100))
);
export const MIN_CREDIT_PURCHASE_USD = Math.max(
  1,
  Math.floor(Number(process.env.MIN_CREDIT_PURCHASE_USD ?? 1))
);
export const MAX_CREDIT_PURCHASE_USD = Math.max(
  MIN_CREDIT_PURCHASE_USD,
  Math.floor(Number(process.env.MAX_CREDIT_PURCHASE_USD ?? 500))
);
export const CREDITS_PER_MINUTE = Math.max(
  1,
  Math.floor(Number(process.env.CREDITS_PER_MINUTE ?? 20))
);

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "http://localhost:3000";

export const ELEVENLABS_DESTINATION = process.env.ELEVENLABS_AGENT_DESTINATION ?? "";
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
export const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID ?? "";

export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
export const TWILIO_FROM = process.env.TWILIO_FROM ?? "";
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
export const TWILIO_API_KEY_SID = process.env.TWILIO_API_KEY_SID ?? "";
export const TWILIO_API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET ?? "";
