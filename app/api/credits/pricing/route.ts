import { NextResponse } from "next/server";
import {
  CREDITS_PER_DOLLAR,
  CREDITS_PER_MINUTE,
  MAX_CREDIT_PURCHASE_USD,
  MIN_CREDIT_PURCHASE_USD,
} from "@/lib/agentchat/config";

export async function GET() {
  return NextResponse.json({
    creditsPerDollar: CREDITS_PER_DOLLAR,
    creditsPerMinute: CREDITS_PER_MINUTE,
    minPurchaseUsd: MIN_CREDIT_PURCHASE_USD,
    maxPurchaseUsd: MAX_CREDIT_PURCHASE_USD,
  });
}
