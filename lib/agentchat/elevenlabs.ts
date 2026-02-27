import { ELEVENLABS_AGENT_ID, ELEVENLABS_API_KEY } from "@/lib/agentchat/config";

type RegisterCallInput = {
  fromNumber: string;
  toNumber: string;
  callSid: string;
  direction: "inbound" | "outbound";
  maxDurationSeconds?: number;
  memoryMode?: "casual" | "coach" | "builder";
};

export async function registerElevenLabsCall(input: RegisterCallInput): Promise<string> {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
    throw new Error("Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID");
  }

  const callPayloadBase = {
    agent_id: ELEVENLABS_AGENT_ID,
    agent_phone_number_id: undefined,
    from_number: input.fromNumber,
    to_number: input.toNumber,
    call_sid: input.callSid,
    call_direction: input.direction,
    conversation_initiation_client_data: {
      type: "conversation_initiation_client_data",
      dynamic_variables: {
        call_sid: input.callSid,
        twilio_call_sid: input.callSid,
        caller_id: input.fromNumber,
        from_number: input.fromNumber,
        memory_mode: input.memoryMode ?? "casual",
      },
    },
  };

  const withMaxDuration =
    typeof input.maxDurationSeconds === "number" && Number.isFinite(input.maxDurationSeconds)
      ? Math.max(1, Math.floor(input.maxDurationSeconds))
      : null;

  const firstPayload =
    withMaxDuration && withMaxDuration > 0
      ? {
          ...callPayloadBase,
          conversation_initiation_client_data: {
            ...(callPayloadBase.conversation_initiation_client_data ?? {}),
            conversation_config_override: {
              conversation: {
                max_duration_seconds: withMaxDuration,
              },
            },
          } as Record<string, unknown>,
        }
      : callPayloadBase;

  let response = await fetch("https://api.elevenlabs.io/v1/convai/twilio/register-call", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": ELEVENLABS_API_KEY,
    },
    body: JSON.stringify(firstPayload),
  });

  if (!response.ok && withMaxDuration) {
    const firstErrorBody = await response.text();

    // If overrides are disabled for the agent, gracefully retry without override
    // so calls still connect instead of hard-failing.
    if (firstErrorBody.toLowerCase().includes("override is not allowed")) {
      response = await fetch("https://api.elevenlabs.io/v1/convai/twilio/register-call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify(callPayloadBase),
      });
    } else {
      throw new Error(`ElevenLabs register-call failed: ${response.status} ${firstErrorBody}`);
    }
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`ElevenLabs register-call failed: ${response.status} ${errorBody}`);
  }

  const raw = await response.text();
  const trimmed = raw.trim();

  // ElevenLabs may return raw TwiML XML or JSON { twiml: "..." } depending on mode.
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<Response")) {
    return trimmed;
  }

  try {
    const body = JSON.parse(trimmed) as { twiml?: string };
    if (body.twiml) {
      return body.twiml;
    }
  } catch {
    // Fall through to detailed error.
  }

  throw new Error(`ElevenLabs register-call response missing twiml. Body: ${trimmed}`);
}
