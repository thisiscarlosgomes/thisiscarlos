import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { reflectFromSource } from "@/lib/agentchat/reflection";
import { isOwnerRequest, VOICE_NOTES_OWNER_ID } from "@/lib/voice-notes/auth";
import { summarizeVoiceNote } from "@/lib/voice-notes/service";
import { VoiceNote } from "@/models/VoiceNote";

export const runtime = "nodejs";

type UpdatePayload = {
  noteId?: string;
  transcript?: string;
};

function normalizeTranscript(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function PATCH(req: Request) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as UpdatePayload;
  const noteId = String(body.noteId ?? "").trim();
  const transcript = normalizeTranscript(body.transcript);

  if (!Types.ObjectId.isValid(noteId)) {
    return NextResponse.json({ error: "Invalid noteId" }, { status: 400 });
  }

  if (!transcript) {
    return NextResponse.json({ error: "Transcript is required" }, { status: 400 });
  }

  if (transcript.length > 20000) {
    return NextResponse.json({ error: "Transcript is too long" }, { status: 400 });
  }

  await connectToDatabase();
  const existing = await VoiceNote.findOne({
    _id: noteId,
    ownerId: VOICE_NOTES_OWNER_ID,
  })
    .select({ _id: 1, createdAt: 1, transcript: 1 })
    .lean<{ _id: Types.ObjectId; createdAt: Date; transcript: string } | null>()
    .exec();

  if (!existing) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  const summary = await summarizeVoiceNote(transcript);

  const updated = await VoiceNote.findOneAndUpdate(
    { _id: noteId, ownerId: VOICE_NOTES_OWNER_ID },
    { $set: { transcript, summary } },
    { returnDocument: "after" }
  )
    .select({ _id: 1, summary: 1, transcript: 1, durationSeconds: 1, createdAt: 1 })
    .lean<{
      _id: Types.ObjectId;
      summary: string;
      transcript: string;
      durationSeconds: number;
      createdAt: Date;
    } | null>()
    .exec();

  if (!updated) {
    return NextResponse.json({ error: "Could not update note" }, { status: 500 });
  }

  try {
    await reflectFromSource({
      sourceType: "voice_note",
      sourceId: String(updated._id),
      text: `${updated.summary}. ${updated.transcript}`,
      topicHint: updated.summary,
      createdAt: updated.createdAt,
    });
  } catch (error) {
    console.error("Voice note reflection failed after edit", error);
  }

  return NextResponse.json({
    note: {
      id: String(updated._id),
      summary: updated.summary,
      transcript: updated.transcript,
      durationSeconds: updated.durationSeconds,
      createdAt: new Date(updated.createdAt).toISOString(),
    },
  });
}

