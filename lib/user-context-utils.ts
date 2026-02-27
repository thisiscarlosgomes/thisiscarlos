import { timingSafeEqual } from "node:crypto";
import { connectToDatabase } from "@/lib/db";
import { CallReservation } from "@/models/CallReservation";

export function unauthorizedJsonResponse() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function secureCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

export function isElevenLabsAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const webhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? "";

  if (!webhookSecret) return false;
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return false;

  return secureCompare(token, webhookSecret);
}

export function normalizePhoneNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const stripped = trimmed.replace(/[\s\-().]/g, "");
  const withPlus = stripped.startsWith("00") ? `+${stripped.slice(2)}` : stripped;
  const normalized = withPlus.startsWith("+") ? withPlus : `+${withPlus}`;

  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

export async function resolvePhoneFromCallSid(rawCallSid: string): Promise<string | null> {
  const callSid = rawCallSid.trim();
  if (!callSid) return null;

  await connectToDatabase();
  const reservation = await CallReservation.findOne({ callSid })
    .select({ callerPhone: 1 })
    .lean<{ callerPhone?: string | null } | null>()
    .exec();

  return normalizePhoneNumber(String(reservation?.callerPhone ?? ""));
}

export async function resolvePhoneFromRequest(url: URL): Promise<string | null> {
  const rawPhoneNumber = url.searchParams.get("phone_number");
  const rawCallSid = url.searchParams.get("call_sid");

  let phoneNumber = normalizePhoneNumber(String(rawPhoneNumber ?? ""));
  if (!phoneNumber && rawCallSid) {
    phoneNumber = await resolvePhoneFromCallSid(rawCallSid);
  }
  return phoneNumber;
}
