import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { OPENAI_MODEL } from "@/lib/agentchat/config";

const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

export class VoiceTranscriptionError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

function clip(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

export async function transcribeVoiceNote(input: {
  file: File;
  mimeType: string;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    throw new VoiceTranscriptionError("Missing OPENAI_API_KEY", "missing_openai_key");
  }

  const configured = String(process.env.VOICE_NOTES_TRANSCRIBE_MODELS ?? "").trim();
  const models = (
    configured
      ? configured.split(",").map((value) => value.trim())
      : [process.env.VOICE_NOTES_TRANSCRIBE_MODEL ?? DEFAULT_TRANSCRIBE_MODEL, "gpt-4o-transcribe", "whisper-1"]
  ).filter(Boolean);

  const filename = input.file.name || "voice-note.webm";
  const attempts: Array<{ model: string; status: number; body: string }> = [];

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const body = new FormData();
      body.set("model", model);
      body.set("file", input.file, filename);

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body,
      });

      if (response.ok) {
        const data = (await response.json()) as { text?: string };
        const transcript = String(data.text ?? "").trim();
        if (transcript) {
          return transcript;
        }
        attempts.push({ model, status: 200, body: "empty transcript" });
        break;
      }

      const errorBody = await response.text();
      attempts.push({
        model,
        status: response.status,
        body: errorBody.slice(0, 400),
      });

      if (response.status >= 500 || response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      break;
    }
  }

  const last = attempts[attempts.length - 1];
  const reason =
    !last
      ? "unknown"
      : last.status === 429
      ? "rate_limited"
      : last.status === 401 || last.status === 403
      ? "auth_error"
      : last.status === 400
      ? "invalid_audio_or_model"
      : last.status >= 500
      ? "upstream_error"
      : "unknown";
  throw new VoiceTranscriptionError(
    `Transcription failed after model fallback. Last: ${last?.model ?? "n/a"} ${last?.status ?? 0}`,
    reason
  );
}

export async function summarizeVoiceNote(transcript: string): Promise<string> {
  const normalized = transcript.replace(/\s+/g, " ").trim();
  if (!normalized) return "New voice note";
  if (!process.env.OPENAI_API_KEY) return clip(normalized, 180);

  try {
    const { text } = await generateText({
      model: openai(OPENAI_MODEL),
      system: "Write a concise one-line summary of a personal voice note.",
      prompt: [
        "Return exactly one sentence under 20 words.",
        "Keep concrete details, no fluff.",
        `Voice note transcript: ${clip(normalized, 4000)}`,
      ].join("\n"),
      maxOutputTokens: 60,
      temperature: 0.2,
    });
    return clip(text || normalized, 180);
  } catch {
    return clip(normalized, 180);
  }
}

export function buildVoiceNotesContext(input: Array<{ summary: string; transcript: string; createdAt: Date }>): {
  notes: Array<{ summary: string; createdAt: string; excerpt: string }>;
  context: string;
  updatedAt: string | null;
} {
  const notes = input.map((note) => ({
    summary: clip(note.summary, 180),
    createdAt: note.createdAt.toISOString(),
    excerpt: clip(note.transcript, 220),
  }));

  const context = notes.map((note, index) => `${index + 1}. ${note.summary}`).join(" ");

  return {
    notes,
    context,
    updatedAt: notes[0]?.createdAt ?? null,
  };
}
