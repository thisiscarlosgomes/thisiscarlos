import { twiml, twimlTextResponse } from "@/lib/agentchat/twilio";

export async function POST() {
  return twimlTextResponse(
    twiml(
      "<Say>Browser calling has been deprecated. Please call the published phone number instead.</Say><Hangup />"
    )
  );
}
