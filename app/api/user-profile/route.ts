import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { CallReservation } from "@/models/CallReservation";
import { User } from "@/models/User";

export const runtime = "nodejs";

function secureCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const webhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? "";

  if (!webhookSecret) return false;
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return false;

  return secureCompare(token, webhookSecret);
}

function normalizePhoneNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const stripped = trimmed.replace(/[\s\-().]/g, "");
  const withPlus = stripped.startsWith("00") ? `+${stripped.slice(2)}` : stripped;
  const normalized = withPlus.startsWith("+") ? withPlus : `+${withPlus}`;

  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

function cleanFirstName(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (trimmed.length > 120) return trimmed.slice(0, 120);
  return trimmed;
}

async function resolvePhoneFromCallSid(rawCallSid: string): Promise<string | null> {
  const callSid = rawCallSid.trim();
  if (!callSid) return null;

  await connectToDatabase();
  const reservation = await CallReservation.findOne({ callSid })
    .select({ callerPhone: 1 })
    .lean<{ callerPhone?: string | null } | null>()
    .exec();

  return normalizePhoneNumber(String(reservation?.callerPhone ?? ""));
}

type Body = {
  phone_number?: string;
  call_sid?: string;
  first_name?: string;
};

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawPhone = String(body.phone_number ?? "");
  const rawCallSid = String(body.call_sid ?? "");
  const rawFirstName = String(body.first_name ?? "");

  let phoneNumber = normalizePhoneNumber(rawPhone);
  if (!phoneNumber && rawCallSid) {
    phoneNumber = await resolvePhoneFromCallSid(rawCallSid);
  }
  const firstName = cleanFirstName(rawFirstName);

  if (!phoneNumber) {
    return NextResponse.json({ error: "Invalid phone_number" }, { status: 400 });
  }
  if (!firstName) {
    return NextResponse.json({ error: "Missing first_name" }, { status: 400 });
  }

  await connectToDatabase();
  await User.updateOne(
    { phoneNumber },
    {
      $setOnInsert: {
        phoneNumber,
      },
      $set: {
        firstName,
        lastSeenAt: new Date(),
      },
    },
    { upsert: true }
  ).exec();

  return NextResponse.json(
    {
      saved: true,
      firstName,
    },
    { status: 200 }
  );
}
