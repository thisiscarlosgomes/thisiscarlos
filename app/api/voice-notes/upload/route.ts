import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { reflectFromSource } from "@/lib/agentchat/reflection";
import { isOwnerRequest, VOICE_NOTES_OWNER_ID } from "@/lib/voice-notes/auth";
import {
  summarizeVoiceNote,
  transcribeVoiceNote,
  VoiceTranscriptionError,
} from "@/lib/voice-notes/service";
import { VoiceNote } from "@/models/VoiceNote";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function readDurationSeconds(value: FormDataEntryValue | null): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export async function POST(req: Request) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const filePart = form.get("file");
  const durationSeconds = readDurationSeconds(form.get("duration_seconds"));

  if (!(filePart instanceof File)) {
    return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
  }

  const mimeType = String(filePart.type || "application/octet-stream").toLowerCase();
  if (!mimeType.startsWith("audio/")) {
    return NextResponse.json({ error: "File must be an audio type" }, { status: 400 });
  }

  if (filePart.size <= 0 || filePart.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio file size is invalid" }, { status: 400 });
  }

  let transcript = "";
  try {
    transcript = await transcribeVoiceNote({ file: filePart, mimeType });
  } catch (error) {
    const code =
      error instanceof VoiceTranscriptionError ? error.code : "unknown_transcription_error";
    console.error("Voice note transcription failed", {
      code,
      message: error instanceof Error ? error.message : String(error),
      mimeType,
      size: filePart.size,
      durationSeconds,
    });
    return NextResponse.json(
      {
        error:
          code === "rate_limited"
            ? "Could not transcribe voice note right now (rate limited). Try again in a minute."
            : "Could not transcribe voice note.",
        code,
      },
      { status: 500 }
    );
  }

  const summary = await summarizeVoiceNote(transcript);
  const audioData = Buffer.from(await filePart.arrayBuffer());

  await connectToDatabase();
  const created = await VoiceNote.create({
    ownerId: VOICE_NOTES_OWNER_ID,
    audioMimeType: mimeType,
    audioData,
    durationSeconds,
    transcript,
    summary,
  });

  try {
    await reflectFromSource({
      sourceType: "voice_note",
      sourceId: String(created._id),
      text: `${created.summary}. ${created.transcript}`,
      topicHint: created.summary,
      createdAt: created.createdAt,
    });
  } catch (error) {
    console.error("Voice note reflection failed", error);
  }

  return NextResponse.json(
    {
      note: {
        id: String(created._id),
        summary: created.summary,
        transcript: created.transcript,
        durationSeconds: created.durationSeconds,
        createdAt: created.createdAt.toISOString(),
      },
    },
    { status: 201 }
  );
}
