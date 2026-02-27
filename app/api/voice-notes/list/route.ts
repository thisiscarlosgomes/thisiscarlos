import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { isOwnerRequest, VOICE_NOTES_OWNER_ID } from "@/lib/voice-notes/auth";
import { VoiceNote } from "@/models/VoiceNote";

export const runtime = "nodejs";

type NoteRow = {
  _id: string;
  summary: string;
  transcript: string;
  durationSeconds: number;
  createdAt: Date;
};

export async function GET(req: Request) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const notes = await VoiceNote.find({ ownerId: VOICE_NOTES_OWNER_ID })
    .sort({ createdAt: -1 })
    .limit(100)
    .select({ summary: 1, transcript: 1, durationSeconds: 1, createdAt: 1 })
    .lean<NoteRow[]>()
    .exec();

  return NextResponse.json({
    notes: notes.map((note) => ({
      id: String(note._id),
      summary: note.summary,
      transcript: note.transcript,
      durationSeconds: note.durationSeconds,
      createdAt: new Date(note.createdAt).toISOString(),
    })),
  });
}
