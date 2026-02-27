import { timingSafeEqual } from "node:crypto";

export const VOICE_NOTES_OWNER_COOKIE = "voice_notes_owner";
export const VOICE_NOTES_OWNER_ID = "owner";

function secureCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

export function getOwnerPassword(): string {
  return process.env.VOICE_NOTES_OWNER_PASSWORD ?? "";
}

export function isOwnerPasswordValid(input: string): boolean {
  const expected = getOwnerPassword();
  if (!expected) return false;
  return secureCompare(input, expected);
}

export function createOwnerSessionValue(): string {
  return getOwnerPassword();
}

export function isOwnerSessionValueValid(input: string): boolean {
  const expected = createOwnerSessionValue();
  if (!expected || !input) return false;
  return secureCompare(input, expected);
}

export function parseCookieHeader(cookieHeader: string): Record<string, string> {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const index = pair.indexOf("=");
      if (index <= 0) return acc;
      const key = pair.slice(0, index).trim();
      const value = decodeURIComponent(pair.slice(index + 1).trim());
      if (key) acc[key] = value;
      return acc;
    }, {});
}

export function isOwnerRequest(req: Request): boolean {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookies = parseCookieHeader(cookieHeader);
  const value = cookies[VOICE_NOTES_OWNER_COOKIE] ?? "";
  return isOwnerSessionValueValid(value);
}
